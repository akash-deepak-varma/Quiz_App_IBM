import os from 'node:os';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prismaClient.js';
import { logJobSummary } from '../../lib/generationLog.js';
import { fromJsonOrNull } from '../../lib/serialization.js';
import { getProvider } from '../../providers/index.js';
import { materializeQuiz } from '../quizMaterializationService.js';
import { classifyError, FAILURE_CATEGORIES } from './failureCategory.js';
import { GENERATION_STATUS, orderByTypeMix, runGeneration } from './orchestrator.js';
import { buildGenerationPlan, planBatches } from './planner.js';
import { countOf, MAX_BATCH_QUESTIONS } from './profile.js';
import { createPrismaStore } from './stores.js';

/**
 * The in-process generation worker.
 *
 * Generation no longer happens inside the HTTP request, so something has to pick the work up. This
 * is that something: a polling loop that claims one job at a time, runs it through the same
 * `runGeneration` the synchronous endpoint uses, and materializes the quiz when it completes.
 *
 * Deliberately not a message queue: one Node process, one table, and a compare-and-swap claim that
 * is safe across several workers and several processes, so scaling out later is a deployment change
 * rather than a rewrite. The claim uses no engine-specific SQL, so this same worker runs on
 * PostgreSQL and on SQLite -- but only Postgres allows genuinely concurrent writers, so running
 * *several* worker processes is a Postgres-only deployment shape.
 *
 * Imported by `server.js` only. `app.js` must not start it: every supertest file imports `app`,
 * and a worker booted there would poll the database throughout the test run.
 */

const WORKER_ID = `${os.hostname()}:${process.pid}`;

// How many claimable jobs one poll will try before giving up. Bounded so a single tick cannot walk
// the whole backlog; if every candidate is lost to a peer, this returns null and the next poll
// (one second later) picks up from the new oldest.
const CLAIM_CANDIDATES = 5;

function modelNameFor(provider) {
  if (provider === 'claude') return env.anthropic.model;
  if (provider === 'openai') return env.openai.model;
  return null;
}

/**
 * Take ownership of the oldest job that needs work.
 *
 * This is a compare-and-swap, not a lock. Read the oldest claimable jobs, then try to flip one with
 * the very same predicate repeated inside the UPDATE's WHERE. If the guarded update reports one row
 * changed, this process owns the job; if it reports none, a peer won the race and we move on to the
 * next candidate. That is what `FOR UPDATE SKIP LOCKED` used to do here, done optimistically across
 * two statements instead of pessimistically in one.
 *
 * Why the guard alone is enough on both engines: a peer's UPDATE blocks on the row until the winner
 * commits and then re-evaluates its own WHERE against committed state -- Postgres READ COMMITTED
 * does this via EvalPlanQual, and SQLite serialises writers outright. So exactly one claimer can
 * still see the row as claimable, and `count` is 0 for everybody else. The same reasoning covers two
 * workers racing to reclaim a single expired lease.
 *
 * The second and third OR branches are crash recovery: a job whose worker died stays `GENERATING`
 * with a stale `lockedAt`, and becomes claimable again once its lease expires.
 *
 * There is deliberately no raw SQL left here. The previous version was one
 * `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING *`, which was both Postgres-only and the source
 * of a bug worth not repeating: `DateTime` columns are `timestamp(3)` *without* time zone holding
 * UTC instants, so the bare `now()` it first used wrote the server's local wall clock into a column
 * every other reader treats as UTC. On this UTC+5:30 machine that made every in-flight job look
 * stale, so the lease protected nothing and two workers could claim one job; west of UTC it would
 * have stretched the lease instead. Every timestamp below is a JS `Date` bound through Prisma's
 * typed `DateTime` mapping, which has no local-zone escape hatch to get wrong.
 *
 * Cost against the single statement: two extra round trips per claim, and a retry rather than a
 * skip under contention. At a one-second poll with a handful of workers, that is noise.
 */
export async function claimNextJob({ workerId = WORKER_ID, leaseMs = env.generationLeaseMs } = {}) {
  const now = new Date();

  // Repeated verbatim in the UPDATE below -- that repetition *is* the compare-and-swap.
  const claimable = {
    OR: [
      { status: GENERATION_STATUS.PENDING },
      { status: GENERATION_STATUS.GENERATING, lockedAt: null },
      { status: GENERATION_STATUS.GENERATING, lockedAt: { lt: new Date(now.getTime() - leaseMs) } },
    ],
  };

  const candidates = await prisma.quizGeneration.findMany({
    where: claimable,
    orderBy: { createdAt: 'asc' },
    take: CLAIM_CANDIDATES,
    select: { id: true, startedAt: true },
  });

  for (const candidate of candidates) {
    const { count } = await prisma.quizGeneration.updateMany({
      where: { id: candidate.id, ...claimable },
      data: {
        status: GENERATION_STATUS.GENERATING,
        lockedAt: now,
        lockedBy: workerId,
        // Stands in for the old SQL COALESCE: a reclaimed job keeps the moment it first started.
        ...(candidate.startedAt ? {} : { startedAt: now }),
      },
    });

    // Re-read rather than trust the candidate: callers expect the full, current row, which is what
    // `RETURNING *` gave them.
    if (count === 1) return prisma.quizGeneration.findUnique({ where: { id: candidate.id } });
  }

  return null;
}

function requestFromJob(job) {
  const typeMix = fromJsonOrNull(job.typeMixJson);
  return {
    topic: job.topic,
    notes: job.notes,
    difficulty: job.difficulty,
    numQuestions: job.requested,
    typeMix: Array.isArray(typeMix) && typeMix.length > 0 ? typeMix : undefined,
    provider: job.provider,
  };
}

/** Staged rows, converted back into the in-memory question shape the rest of the code speaks. */
async function loadStagedQuestions(generationId) {
  const rows = await prisma.generatedQuestion.findMany({
    where: { generationId },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    prompt: row.prompt,
    options: fromJsonOrNull(row.optionsJson),
    starterCode: row.starterCode,
    correctAnswer: fromJsonOrNull(row.correctAnswer),
    explanation: row.explanation,
  }));
}

function sumCountsOf(batches) {
  return batches.reduce((totals, batch) => {
    for (const [type, count] of Object.entries(batch.counts)) {
      totals[type] = (totals[type] ?? 0) + count;
    }
    return totals;
  }, {});
}

/** What the plan still owes, per type, given what is already staged. */
function outstandingCounts(planned, staged) {
  const delivered = new Map();
  for (const question of staged) {
    delivered.set(question.type, (delivered.get(question.type) ?? 0) + 1);
  }

  const outstanding = {};
  for (const [type, want] of Object.entries(planned)) {
    const missing = want - (delivered.get(type) ?? 0);
    if (missing > 0) outstanding[type] = missing;
  }
  return outstanding;
}

/**
 * Generate the part of a job that is not already persisted.
 *
 * A resumed job re-plans only its shortfall; the questions already in the staging table are never
 * regenerated. That is the payoff for persisting batch by batch -- a restart costs the in-flight
 * batches, not the quiz.
 */
async function generateOutstanding(job) {
  const request = requestFromJob(job);
  const provider = getProvider(job.provider);
  const fullPlan = buildGenerationPlan(request);
  const staged = await loadStagedQuestions(job.id);
  const resuming = staged.length > 0;

  if (!job.planJson) {
    await prisma.quizGeneration.update({
      where: { id: job.id },
      data: {
        planJson: JSON.stringify(fullPlan),
        contextMode: fullPlan.contextMode,
        model: modelNameFor(job.provider),
      },
    });
  }

  const outstanding = outstandingCounts(sumCountsOf(fullPlan.batches), staged);
  const missing = countOf(outstanding);
  // Everything the plan asked for is already staged -- a previous run produced the questions and
  // died before materializing the quiz. There is nothing to generate; go straight to finalizing.
  if (missing === 0) return { plan: fullPlan, result: null, resumed: resuming };

  // Question indices spent by earlier runs must never come round again: the mock provider numbers
  // prompts from `startIndex`, so a reused index means a byte-identical prompt that the dedupe step
  // rejects -- turning a recoverable shortfall into a permanent one. Each attempt can have consumed
  // at most `MAX_BATCH_QUESTIONS` indices, so this clears everything the previous run could reach.
  const indexBase = resuming ? job.requested + (job.attempts + 1) * MAX_BATCH_QUESTIONS : 0;

  const plan = {
    ...fullPlan,
    totalQuestions: missing,
    batches: planBatches(outstanding, { startIndex: indexBase, idPrefix: resuming ? 'c' : 'b' }),
  };

  const result = await runGeneration({
    request,
    plan,
    provider,
    store: createPrismaStore(job.id),
    generationId: job.id,
    indexBase: indexBase + missing,
    // `finalizeJob` logs the summary instead: this call was asked only for `missing` questions, so
    // its own totals describe the run rather than the job the operator is looking for.
    logSummary: false,
  });

  return { plan: fullPlan, result, resumed: resuming };
}

/**
 * Decide the job's terminal state and, when it delivered everything, build the quiz.
 *
 * The staging table -- not `runGeneration`'s return value -- is the source of truth here, because a
 * resumed job's return value only covers the questions this run produced.
 */
async function finalizeJob(job, { plan, result, resumed = false }) {
  const staged = await loadStagedQuestions(job.id);
  const ordered = orderByTypeMix(staged, plan.types).slice(0, job.requested);

  const fresh = await prisma.quizGeneration.findUnique({
    where: { id: job.id },
    select: { cancelRequested: true },
  });

  const status = fresh?.cancelRequested
    ? GENERATION_STATUS.CANCELLED
    : ordered.length >= job.requested
      ? GENERATION_STATUS.READY
      : ordered.length > 0
        ? GENERATION_STATUS.PARTIAL
        : GENERATION_STATUS.FAILED;

  const failure = {
    failureCategory:
      status === GENERATION_STATUS.READY
        ? null
        : status === GENERATION_STATUS.CANCELLED
          ? FAILURE_CATEGORIES.CANCELLED
          : (result?.failureCategory ?? FAILURE_CATEGORIES.UNKNOWN),
    failureReason: status === GENERATION_STATUS.READY ? null : (result?.failureReason ?? null),
  };

  // Logged from here rather than from `runGeneration`, which only ever sees the slice of the job the
  // current run was asked for. These are the numbers the progress endpoint reports and the ones an
  // operator is looking for; `resumed` is what distinguishes a recovered job from a first attempt.
  logJobSummary({
    generationId: job.id,
    provider: job.provider,
    status,
    requested: job.requested,
    generated: ordered.length,
    batches: plan.batches.length,
    attempts: job.attempts + (result?.attempts ?? 0),
    // Two keys because they are two different numbers on a resumed job: `durationMs` is what the
    // generation work cost this run, `elapsedMs` is wall clock since the job was first claimed and so
    // includes however long it sat abandoned. Collapsing them would report an hour of downtime as an
    // hour of slow generation.
    durationMs: result?.durationMs ?? 0,
    elapsedMs: Date.now() - (job.startedAt?.getTime() ?? Date.now()),
    resumed,
    ...failure,
  });

  if (status !== GENERATION_STATUS.READY) {
    // Staged questions are kept, not deleted: they are what a resumed job builds on, and what a
    // future "start the 8 questions we did get" feature would need. PARTIAL is modelled here and
    // deliberately not offered to the learner yet.
    await prisma.quizGeneration.update({
      where: { id: job.id },
      data: {
        status,
        generated: Math.min(staged.length, job.requested),
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        ...failure,
      },
    });
    return { id: job.id, status, generated: ordered.length };
  }

  const quiz = await prisma.$transaction(async (tx) => {
    const created = await materializeQuiz(
      {
        userId: job.userId,
        topic: job.topic,
        difficulty: job.difficulty,
        providerUsed: job.provider,
        notes: job.notes,
        tags: fromJsonOrNull(job.tagsJson) ?? [],
        questions: ordered,
      },
      tx
    );

    // Record where each staged question ended up, so the staging table stays readable after the
    // fact rather than being a bag of rows in arrival order.
    for (const [index, question] of ordered.entries()) {
      await tx.generatedQuestion.update({ where: { id: question.id }, data: { orderIndex: index } });
    }

    await tx.quizGeneration.update({
      where: { id: job.id },
      data: {
        status: GENERATION_STATUS.READY,
        quizId: created.id,
        generated: ordered.length,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        failureCategory: null,
        failureReason: null,
      },
    });

    return created;
  });

  return { id: job.id, status: GENERATION_STATUS.READY, generated: ordered.length, quizId: quiz.id };
}

/**
 * Claim and run exactly one job, or return null when the queue is empty.
 *
 * Exported so tests (and an operator) can drive a single tick deterministically, with no timers
 * involved -- the poll loop below is nothing more than repeated calls to this.
 */
export async function runOneJob(options = {}) {
  const job = await claimNextJob(options);
  if (!job) return null;

  try {
    const outcome = await generateOutstanding(job);
    return await finalizeJob(job, outcome);
  } catch (err) {
    // An unexpected throw here is a bug or an outage, not a provider refusal -- those come back as
    // classified failures inside `runGeneration`. Fail the job rather than leaving it GENERATING
    // for a lease window and then failing it again on the next worker.
    console.error('[GEN] job crashed', { generationId: job.id, name: err?.name, message: err?.message });

    await prisma.quizGeneration
      .update({
        where: { id: job.id },
        data: {
          status: GENERATION_STATUS.FAILED,
          failureCategory: classifyError(err),
          failureReason: String(err?.message ?? 'unknown error').slice(0, 500),
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      })
      .catch(() => {});

    return { id: job.id, status: GENERATION_STATUS.FAILED };
  }
}

let timer = null;
let stopped = true;

/**
 * Start the poll loop. A `setTimeout` chain rather than `setInterval`, so a job that outlasts the
 * poll interval can never have a second tick start underneath it.
 */
export function startGenerationWorker({
  pollMs = env.generationWorkerPollMs,
  enabled = env.generationWorkerEnabled,
} = {}) {
  if (!enabled) {
    console.log('[GEN] worker disabled (GENERATION_WORKER_ENABLED=false)');
    return stopGenerationWorker;
  }
  if (timer) return stopGenerationWorker;

  stopped = false;
  console.log('[GEN] worker started', { workerId: WORKER_ID, pollMs, leaseMs: env.generationLeaseMs });

  const tick = async () => {
    let claimed = null;
    try {
      claimed = await runOneJob();
    } catch (err) {
      console.error('[GEN] worker tick failed', { name: err?.name, message: err?.message });
    }

    if (stopped) return;
    // Drain immediately after a job: a queue of three should not take three poll intervals.
    timer = setTimeout(tick, claimed ? 0 : pollMs);
    timer.unref?.();
  };

  timer = setTimeout(tick, pollMs);
  timer.unref?.();
  return stopGenerationWorker;
}

export function stopGenerationWorker() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
