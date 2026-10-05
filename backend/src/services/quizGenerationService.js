import { getProvider } from '../providers/index.js';
import { QuizGenerationFailedError } from '../lib/errors.js';
import { buildGenerationPlan } from './generation/planner.js';
import { runGeneration, GENERATION_STATUS } from './generation/orchestrator.js';
import { createMemoryStore } from './generation/stores.js';
import { resolveAiConfig } from './aiConfigService.js';

/**
 * Synchronous quiz generation.
 *
 * Signature and return shape are unchanged from the single-call version this replaces, because
 * `POST /api/quiz/generate` and `regenerateQuestion` both depend on them. What changed is
 * underneath: the quiz is now planned into batches, validated question by question, and retried
 * surgically. A malformed question costs one small re-request instead of the whole quiz.
 *
 * Still all-or-nothing on the way out -- a 201 that promises N questions has to deliver N, and
 * there is no durable job to hand a partial result to. Partial results are the async path's
 * reason to exist (`POST /api/quiz/generations`).
 */
export async function generateValidatedQuiz(params) {
  // `params.userId` is how credentials reach this path: resolveAiConfig loads and decrypts the
  // requesting user's own key. A caller that passes `provider: 'mock'` needs no userId at all,
  // which is why every mock-based test fixture still works untouched.
  const { provider: providerName, runtime } = await resolveAiConfig({
    userId: params.userId,
    requestedProvider: params.provider,
  });
  const provider = getProvider(providerName, runtime);
  const plan = buildGenerationPlan(params);
  const store = createMemoryStore();

  const result = await runGeneration({ request: params, plan, provider, store });

  if (result.status !== GENERATION_STATUS.READY) {
    throw new QuizGenerationFailedError({
      status: result.status,
      requested: result.requested,
      generated: result.generated,
      attempts: result.attempts,
      failureCategory: result.failureCategory,
      failureReason: result.failureReason,
    });
  }

  return {
    quiz: { topic: params.topic, difficulty: params.difficulty, questions: result.questions },
    providerUsed: provider.name,
  };
}
