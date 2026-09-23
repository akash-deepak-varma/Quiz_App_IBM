import { prisma } from '../lib/prismaClient.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { getProvider } from '../providers/index.js';
import { buildGenerationPlan } from '../services/generation/planner.js';
import { FAILURE_CATEGORIES } from '../services/generation/failureCategory.js';
import { GENERATION_STATUS } from '../services/generation/orchestrator.js';
import { parseGenerateRequest } from '../validation/generateRequest.js';

/**
 * Asynchronous quiz generation.
 *
 * `POST /api/quiz/generate` does the whole job inside the request, which is why a 20-question quiz
 * could spend minutes in a hanging fetch and then fail with nothing to show. These three endpoints
 * separate *asking* for a quiz from *waiting* for it: the POST returns in milliseconds with a job
 * id, the worker does the work, and the browser polls a counter.
 */

const TERMINAL_STATUSES = new Set([
  GENERATION_STATUS.READY,
  GENERATION_STATUS.PARTIAL,
  GENERATION_STATUS.FAILED,
  GENERATION_STATUS.CANCELLED,
]);

function serializeJob(job) {
  return {
    generationId: job.id,
    status: job.status,
    requested: job.requested,
    generated: job.generated,
    topic: job.topic,
    difficulty: job.difficulty,
    provider: job.provider,
    quizId: job.quizId ?? null,
    failureCategory: job.failureCategory ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
  };
}

async function loadOwnedJob(userId, id) {
  const job = await prisma.quizGeneration.findUnique({ where: { id } });
  if (!job || job.userId !== userId) {
    throw new NotFoundError('Generation not found');
  }
  return job;
}

export async function create(req, res, next) {
  try {
    const { topic, notes, difficulty, numQuestions, typeMix, provider, tags } = parseGenerateRequest(req.body);

    // Resolve the provider now so an unsupported name is a 400 here rather than a job that fails
    // seconds later in the worker, where nobody is listening.
    const resolved = getProvider(provider);
    const plan = buildGenerationPlan({ topic, notes, difficulty, numQuestions, typeMix });

    const job = await prisma.quizGeneration.create({
      data: {
        userId: req.user.id,
        topic,
        notes,
        difficulty,
        typeMixJson: typeMix ? JSON.stringify(typeMix) : null,
        tagsJson: tags.length > 0 ? JSON.stringify(tags) : null,
        provider: resolved.name,
        requested: numQuestions,
        status: GENERATION_STATUS.PENDING,
        planJson: JSON.stringify(plan),
        contextMode: plan.contextMode,
      },
    });

    // 202, not 201: the quiz does not exist yet, and pretending otherwise would put a quizId in
    // this response that nothing could fetch.
    res.status(202).json({
      generationId: job.id,
      status: job.status,
      requested: job.requested,
      generated: job.generated,
      batches: plan.batches.length,
    });
  } catch (err) {
    next(err);
  }
}

export async function getStatus(req, res, next) {
  try {
    const job = await loadOwnedJob(req.user.id, req.params.id);
    res.json(serializeJob(job));
  } catch (err) {
    next(err);
  }
}

export async function cancel(req, res, next) {
  try {
    const job = await loadOwnedJob(req.user.id, req.params.id);

    if (TERMINAL_STATUSES.has(job.status)) {
      throw new ConflictError(`This generation has already finished (${job.status})`);
    }

    // Cooperative: the worker checks this flag between batch attempts. A request already in flight
    // at the provider cannot be recalled, so cancellation is "stop starting new work", not "stop
    // immediately" -- and a PENDING job never claimed is simply finished here.
    const updated = await prisma.quizGeneration.update({
      where: { id: job.id },
      data:
        job.status === GENERATION_STATUS.PENDING
          ? {
              cancelRequested: true,
              status: GENERATION_STATUS.CANCELLED,
              finishedAt: new Date(),
              failureCategory: FAILURE_CATEGORIES.CANCELLED,
            }
          : { cancelRequested: true },
    });

    res.json(serializeJob(updated));
  } catch (err) {
    next(err);
  }
}
