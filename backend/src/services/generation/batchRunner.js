import { validateQuizBatch } from '../../validation/quizSchema.js';
import { FAILURE_CATEGORIES, classifyError } from './failureCategory.js';

const MAX_REASON_LENGTH = 500;

function truncateReason(text) {
  const value = String(text ?? '');
  return value.length > MAX_REASON_LENGTH ? `${value.slice(0, MAX_REASON_LENGTH)}...` : value;
}

/**
 * Run exactly one batch: prompt the provider, then validate every returned question on its own.
 *
 * Never throws. A batch is an *outcome*, not an exception -- the orchestrator needs the valid
 * items even when some of the batch was unusable, which a thrown error cannot carry. This is the
 * whole difference from the old `generateValidatedQuiz` loop, where any failure discarded the
 * entire response.
 *
 * @returns {Promise<{accepted: any[], rejected: Array<{index: number, errors: string[]}>, durationMs: number, failure: {category: string, reason: string}|null, usage: any}>}
 */
export async function runBatch({ unit, request, provider, avoidPrompts = [] }) {
  const startedAt = Date.now();

  try {
    const raw = await provider.generateQuiz({
      topic: request.topic,
      notes: request.notes,
      difficulty: request.difficulty,
      numQuestions: unit.count,
      typeMix: Object.keys(unit.counts),
      typeCounts: unit.counts,
      startIndex: unit.startIndex,
      totalQuestions: request.numQuestions,
      avoidPrompts,
      correction: unit.correction ?? null,
    });

    const { envelopeErrors, items } = validateQuizBatch(raw, { typeQuota: unit.counts });
    const durationMs = Date.now() - startedAt;

    if (envelopeErrors.length > 0) {
      return {
        accepted: [],
        rejected: [],
        durationMs,
        usage: raw?.usage ?? null,
        failure: {
          category: FAILURE_CATEGORIES.SCHEMA_INVALID,
          reason: truncateReason(envelopeErrors.join('; ')),
        },
      };
    }

    const accepted = items.filter((item) => item.ok).map((item) => item.question);
    const rejected = items
      .filter((item) => !item.ok)
      .map((item) => ({ index: item.index, errors: item.errors }));

    const failure =
      rejected.length > 0
        ? {
            category: FAILURE_CATEGORIES.SCHEMA_INVALID,
            reason: truncateReason(rejected.flatMap((item) => item.errors).join('; ')),
          }
        : null;

    return { accepted, rejected, durationMs, usage: raw?.usage ?? null, failure };
  } catch (err) {
    return {
      accepted: [],
      rejected: [],
      durationMs: Date.now() - startedAt,
      usage: null,
      failure: { category: classifyError(err), reason: truncateReason(err?.message) },
    };
  }
}
