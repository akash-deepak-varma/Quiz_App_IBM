import { env } from '../../config/env.js';
import { logBatchAttempt, logJobSummary } from '../../lib/generationLog.js';
import { runBatch } from './batchRunner.js';
import { FAILURE_CATEGORIES, isRetryable, isTransient } from './failureCategory.js';
import { planBatches } from './planner.js';
import { backoffDelayMs, mapWithConcurrency, sleep } from './pool.js';
import { countOf } from './profile.js';

export const GENERATION_STATUS = {
  PENDING: 'PENDING',
  GENERATING: 'GENERATING',
  READY: 'READY',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

/** How many prompts to show the model as "already covered". Capped so the hint cannot itself
 *  become the thing that overflows the context window. */
const AVOID_PROMPT_HINT_LIMIT = 12;

function normalizePrompt(prompt) {
  return String(prompt ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** What this unit asked for minus what it actually delivered, per type. */
function shortfallOf(counts, accepted) {
  const delivered = new Map();
  for (const question of accepted) {
    delivered.set(question.type, (delivered.get(question.type) ?? 0) + 1);
  }
  const shortfall = {};
  for (const [type, want] of Object.entries(counts)) {
    const missing = want - (delivered.get(type) ?? 0);
    if (missing > 0) shortfall[type] = missing;
  }
  return shortfall;
}

/**
 * Tell the model what was wrong with its last answer. The old loop resent a byte-identical
 * prompt, so a model that misunderstood the schema once misunderstood it again; naming the
 * specific violation is the cheapest thing that changes the odds.
 */
function buildCorrection(failure) {
  if (!failure) return null;
  if (failure.category === FAILURE_CATEGORIES.SCHEMA_INVALID) {
    return `Your previous response was rejected by schema validation: ${failure.reason}. Fix exactly these problems and return only the questions requested below.`;
  }
  if (failure.category === FAILURE_CATEGORIES.PARSE_ERROR) {
    return 'Your previous response could not be parsed as JSON. Return a single raw JSON object with no prose, no markdown fences and no trailing commas.';
  }
  return null;
}

function splitIntoSingles(shortfall) {
  const units = [];
  for (const [type, count] of Object.entries(shortfall)) {
    for (let i = 0; i < count; i += 1) units.push({ [type]: 1 });
  }
  return units;
}

/**
 * The retry ladder (solution.md section 5.3). Returns the follow-up work for a unit that came
 * back short, or `[]` to give up on it. Every returned unit has a strictly higher `attempt`, so
 * the queue is bounded by `maxAttempts` regardless of how the ladder branches.
 */
function nextUnits({ unit, shortfall, failure, maxAttempts }) {
  const attempt = unit.attempt + 1;
  const category = failure?.category ?? FAILURE_CATEGORIES.UNKNOWN;

  if (attempt > maxAttempts) return [];
  if (!isRetryable(category)) return [];

  const types = Object.keys(shortfall);
  const total = countOf(shortfall);
  const correction = buildCorrection(failure);

  // Truncation means the response did not fit, so resending it unchanged cannot fit either.
  // Split instead: by type first (each type's rules are then the only ones in the prompt),
  // then in half.
  if (category === FAILURE_CATEGORIES.OUTPUT_TRUNCATED && total > 1) {
    if (types.length > 1) {
      return types.map((type) => ({ counts: { [type]: shortfall[type] }, attempt, correction: null }));
    }
    const half = Math.ceil(total / 2);
    return [
      { counts: { [types[0]]: half }, attempt, correction: null },
      { counts: { [types[0]]: total - half }, attempt, correction: null },
    ];
  }

  // Last permitted attempt: isolate the remainder so one stubborn question cannot drag the
  // others down with it.
  if (attempt === maxAttempts && total > 1) {
    return splitIntoSingles(shortfall).map((counts) => ({ counts, attempt, correction }));
  }

  return [{ counts: shortfall, attempt, correction }];
}

/**
 * Run a whole generation: plan -> batches -> retry ladder -> ordered questions.
 *
 * Provider- and storage-agnostic on purpose. The synchronous `/generate` shim passes a memory
 * store, the background worker passes a Prisma store, and both therefore exercise the same
 * batching, validation and recovery logic -- the sync and async paths cannot drift apart.
 *
 * @param {object} args
 * @param {object} args.request       `{ topic, notes, difficulty, numQuestions, typeMix }`
 * @param {object} args.plan          from `buildGenerationPlan`
 * @param {object} args.provider      a provider module (`generateQuiz` is all this uses)
 * @param {object} args.store         `saveQuestions` / `recordBatchAttempt` / `getAcceptedPrompts` / `isCancelled`
 * @param {number} [args.indexBase]   first question index available to retry/split units; a resumed
 *                                    job passes one past its plan's range so it cannot reuse an
 *                                    index the previous run already spent
 * @param {boolean} [args.logSummary] whether to emit the `generation_finished` line. The worker sets
 *                                    this false and logs its own: a resumed run is asked only for the
 *                                    shortfall, so this function's `requested`/`generated` describe
 *                                    the run and not the job, and a log line saying `requested: 4`
 *                                    for a 6-question request is worse than no line at all.
 */
export async function runGeneration({
  request,
  plan,
  provider,
  store,
  generationId = null,
  indexBase = null,
  logSummary = true,
  concurrency = env.aiGenerationConcurrency,
  maxAttempts = env.aiGenerationMaxBatchAttempts,
}) {
  const jobStartedAt = Date.now();
  const requested = plan.totalQuestions;

  const accepted = [];
  const seen = new Set();
  let attemptsRun = 0;
  let cancelled = false;
  let lastFailure = null;

  // Resumed jobs already have rows in the store; seeding from them is what stops a restart from
  // regenerating -- and re-proposing -- work that is already persisted.
  for (const prompt of await store.getAcceptedPrompts()) {
    seen.add(normalizePrompt(prompt));
  }

  // Retry and split units need question indices that no other unit has used, otherwise the mock
  // provider (which numbers prompts from `startIndex`) emits byte-identical questions that the
  // dedupe step below would reject, turning a recoverable batch into a permanent shortfall.
  let indexCursor = indexBase ?? requested;
  const takeIndex = (count) => {
    const start = indexCursor;
    indexCursor += count;
    return start;
  };

  async function attemptUnit(unit) {
    const avoidPrompts = accepted.slice(-AVOID_PROMPT_HINT_LIMIT).map((q) => q.prompt);
    const result = await runBatch({ unit, request, provider, avoidPrompts });
    attemptsRun += 1;

    let duplicates = 0;
    const fresh = [];
    for (const question of result.accepted) {
      const key = normalizePrompt(question.prompt);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      fresh.push(question);
    }

    if (fresh.length > 0) {
      accepted.push(...fresh);
      // Persist before deciding anything else: work that reached the provider and validated must
      // survive a crash on the very next line.
      await store.saveQuestions(unit, fresh);
    }

    const shortfall = shortfallOf(unit.counts, fresh);
    const short = countOf(shortfall);
    const failure =
      short > 0 && !result.failure && duplicates > 0
        ? { category: FAILURE_CATEGORIES.SCHEMA_INVALID, reason: 'duplicate question prompts' }
        : result.failure;

    const status = short === 0 ? 'SUCCEEDED' : fresh.length > 0 ? 'PARTIAL' : 'FAILED';
    const record = {
      generationId,
      batchId: unit.id,
      types: Object.keys(unit.counts),
      requested: unit.count,
      accepted: fresh.length,
      rejected: result.rejected.length,
      duplicates,
      attempt: unit.attempt,
      status,
      durationMs: result.durationMs,
      usage: result.usage ?? null,
      failureCategory: failure?.category ?? null,
      failureReason: failure?.reason ?? null,
    };
    await store.recordBatchAttempt(record);
    logBatchAttempt(record);

    if (short > 0) lastFailure = failure ?? lastFailure;
    return { shortfall, short, failure };
  }

  /** Drive one plan batch to completion (or to the end of its ladder). */
  async function fulfil(batch) {
    const queue = [{ ...batch, attempt: 1, correction: null }];

    while (queue.length > 0) {
      if (await store.isCancelled()) {
        cancelled = true;
        return;
      }

      const unit = queue.shift();
      const { shortfall, short, failure } = await attemptUnit(unit);
      if (short === 0) continue;

      if (failure?.category === FAILURE_CATEGORIES.CANCELLED) {
        cancelled = true;
        return;
      }

      const followUps = nextUnits({ unit, shortfall, failure, maxAttempts });
      if (followUps.length === 0) continue;

      if (isTransient(failure?.category)) {
        await sleep(backoffDelayMs(unit.attempt));
      }

      for (const followUp of followUps) {
        const count = countOf(followUp.counts);
        queue.push({
          id: `${unit.id}.r${followUp.attempt}`,
          counts: followUp.counts,
          count,
          startIndex: takeIndex(count),
          attempt: followUp.attempt,
          correction: followUp.correction,
        });
      }
    }
  }

  await mapWithConcurrency(plan.batches, concurrency, fulfil);

  // One top-up pass. Batches fail independently, so a job can end a few questions short with no
  // batch left to retry; re-planning the remainder once is what turns a common PARTIAL into a
  // READY without giving any single batch unbounded attempts.
  if (!cancelled && accepted.length > 0 && accepted.length < requested) {
    const outstanding = shortfallOf(
      plan.batches.reduce((totals, batch) => {
        for (const [type, count] of Object.entries(batch.counts)) {
          totals[type] = (totals[type] ?? 0) + count;
        }
        return totals;
      }, {}),
      accepted
    );
    const missing = countOf(outstanding);
    if (missing > 0) {
      const topUp = planBatches(outstanding, { startIndex: takeIndex(missing), idPrefix: 't' });
      await mapWithConcurrency(topUp, concurrency, fulfil);
    }
  }

  const questions = orderByTypeMix(accepted, plan.types).slice(0, requested);
  const status = cancelled
    ? GENERATION_STATUS.CANCELLED
    : questions.length >= requested
      ? GENERATION_STATUS.READY
      : questions.length > 0
        ? GENERATION_STATUS.PARTIAL
        : GENERATION_STATUS.FAILED;

  const summary = {
    generationId,
    provider: provider.name,
    status,
    requested,
    generated: questions.length,
    batches: plan.batches.length,
    attempts: attemptsRun,
    durationMs: Date.now() - jobStartedAt,
    contextMode: plan.contextMode,
    failureCategory:
      status === GENERATION_STATUS.READY
        ? null
        : cancelled
          ? FAILURE_CATEGORIES.CANCELLED
          : (lastFailure?.category ?? FAILURE_CATEGORIES.UNKNOWN),
    failureReason: status === GENERATION_STATUS.READY ? null : (lastFailure?.reason ?? null),
  };
  if (logSummary) logJobSummary(summary);

  return { ...summary, questions };
}

/**
 * Re-interleave the finished questions across the requested type mix.
 *
 * Batches are single- or few-typed, so concatenating them would cluster every MCQ together --
 * visibly different from today's `types[i % types.length]` ordering, and against the prompt's own
 * "distribute types rather than clustering" instruction.
 */
export function orderByTypeMix(questions, types = []) {
  const buckets = new Map();
  for (const question of questions) {
    if (!buckets.has(question.type)) buckets.set(question.type, []);
    buckets.get(question.type).push(question);
  }

  const cycle = [...new Set([...types, ...buckets.keys()])];
  const ordered = [];
  const guard = questions.length * Math.max(1, cycle.length) + cycle.length;

  for (let i = 0; ordered.length < questions.length && i < guard; i += 1) {
    const bucket = buckets.get(cycle[i % cycle.length]);
    if (bucket && bucket.length > 0) ordered.push(bucket.shift());
  }
  // Defensive: anything the cycle could not place keeps its arrival order rather than vanishing.
  for (const bucket of buckets.values()) ordered.push(...bucket.splice(0));

  return ordered;
}
