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
 * Deliberately not a message queue. One Node process, one Postgres table, `FOR UPDATE SKIP
 * LOCKED` for the claim -- which is already safe for several workers and several processes, so
 * scaling out later is a deployment change rather than a rewrite.
 *
 * Imported by `server.js` only. `app.js` must not start it: every supertest file imports `app`,
 * and a worker booted there would poll the database throughout the test run.
 */

const WORKER_ID = `${os.hostname()}:${process.pid}`;

function modelNameFor(provider) {
  if (provider === 'claude') return env.anthropic.model;
  if (provider === 'openai') return env.openai.model;
  return null;
}

/**
 * Take ownership of the oldest job that needs work.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe to run in several processes at once: a
 * concurrent claimer skips the locked row instead of blocking on it or stealing it. The second
 * branch of the WHERE is crash recovery -- a job whose worker died stays `GENERATING` with a stale
 * `lockedAt`, and becomes claimable again once its lease expires.
 *
 * The table is referenced unqualified on purpose: tests run against the same database under
 * `?schema=test`, so a hardcoded `public.` would send them at the development data.
 *
 * Every timestamp here goes through `AT TIME ZONE 'utc'`, and the lease window is computed in SQL
 * rather than passed in as a JS `Date`. Prisma's `DateTime` columns are `timestamp(3)` *without*
 * time zone holding UTC instants, so a bare `now()` writes the server's local wall clock into a
 * column everything else reads as UTC -- and comparing such a column against a driver-typed
 * timestamptz parameter shifts the comparison by the local offset. On a UTC+5:30 machine that made
 * every in-flight job look stale, so the lease protected nothing and two workers could claim the
 * same job; west of UTC it would have done the opposite and stretched the lease.
 */
export async function claimNextJob({ workerId = WORKER_ID, leaseMs = env.generationLeaseMs } = {}) {
  const rows = await prisma.$queryRaw`
    UPDATE "QuizGeneration"
       SET status      = 'GENERATING',
           "lockedAt"  = (now() AT TIME ZONE 'utc'),
           "lockedBy"  = ${workerId},
           "startedAt" = COALESCE("startedAt", now() AT TIME ZONE 'utc')
     WHERE id = (
       SELECT id
         FROM "QuizGeneration"
        WHERE status = 'PENDING'
           OR (
             status = 'GENERATING'
             AND (
               "lockedAt" IS NULL
               OR "lockedAt" < (now() AT TIME ZONE 'utc') - (interval '1 millisecond' * ${leaseMs}::double precision)
             )
           )
        ORDER BY "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING *`;

  return rows[0] ?? null;
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
