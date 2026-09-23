import { QUESTION_TYPES } from '../../constants/enums.js';
import {
  BATCH_WEIGHT_BUDGET,
  MAX_BATCH_QUESTIONS,
  countOf,
  profileFor,
  weightOf,
} from './profile.js';

/** Context tiers from solution.md section 6. Only DIRECT changes behaviour in this phase --
 *  DISTILLED and RETRIEVAL are recorded for telemetry and are handled as DIRECT until the
 *  distillation and retrieval phases land. */
export const CONTEXT_MODES = { DIRECT: 'DIRECT', DISTILLED: 'DISTILLED', RETRIEVAL: 'RETRIEVAL' };

const DIRECT_CHAR_BUDGET = 8000;
const DISTILLED_CHAR_BUDGET = 32000;

export function pickContextMode(notes) {
  const length = typeof notes === 'string' ? notes.trim().length : 0;
  if (length <= DIRECT_CHAR_BUDGET) return CONTEXT_MODES.DIRECT;
  if (length <= DISTILLED_CHAR_BUDGET) return CONTEXT_MODES.DISTILLED;
  return CONTEXT_MODES.RETRIEVAL;
}

/**
 * Spread `numQuestions` over `types` using the same round-robin the prompt and the mock provider
 * have always used (`types[i % types.length]`), so introducing batching does not silently change
 * any quiz's type distribution.
 */
function countByType(numQuestions, types) {
  const counts = new Map();
  for (let i = 0; i < numQuestions; i += 1) {
    const type = types[i % types.length];
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

/**
 * Split each type's total into chunks no larger than that type's `batchSize`, then merge leftover
 * chunks from *different* types while the merged call stays inside the weight and question
 * budgets. One heavy type therefore still gets its own small call, while a handful of singletons
 * ride together.
 */
function packBatches(counts) {
  const chunks = [];
  for (const [type, total] of counts) {
    const { batchSize } = profileFor(type);
    let remaining = total;
    while (remaining > 0) {
      const count = Math.min(batchSize, remaining);
      chunks.push({ type, count });
      remaining -= count;
    }
  }

  // Heaviest first: a full-size heavy chunk claims its own call, and the light tail packs into
  // whatever room is left rather than stranding singletons at the end.
  chunks.sort((a, b) => weightOf({ [b.type]: b.count }) - weightOf({ [a.type]: a.count }));

  const packed = [];
  for (const chunk of chunks) {
    const target = packed.find((batch) => {
      const merged = { ...batch, [chunk.type]: (batch[chunk.type] ?? 0) + chunk.count };
      return weightOf(merged) <= BATCH_WEIGHT_BUDGET && countOf(merged) <= MAX_BATCH_QUESTIONS;
    });
    if (target) {
      target[chunk.type] = (target[chunk.type] ?? 0) + chunk.count;
    } else {
      // A single chunk may exceed the budget on its own (2 debug = 10). That is intentional: the
      // per-type batchSize is the authority for a lone type; the budget only governs merging.
      packed.push({ [chunk.type]: chunk.count });
    }
  }
  return packed;
}

/**
 * Turn an explicit per-type count map into numbered batches. Shared by the initial plan and by
 * the orchestrator's top-up pass, so a top-up batches by the same rules as a first attempt.
 */
export function planBatches(counts, { startIndex = 0, idPrefix = 'b' } = {}) {
  const map = counts instanceof Map ? counts : new Map(Object.entries(counts));
  const batches = [];
  let cursor = startIndex;
  for (const batchCounts of packBatches(map)) {
    const count = countOf(batchCounts);
    batches.push({
      id: `${idPrefix}${batches.length + 1}`,
      counts: batchCounts,
      count,
      weight: weightOf(batchCounts),
      startIndex: cursor,
    });
    cursor += count;
  }
  return batches;
}

/**
 * Pure: request -> execution plan. No I/O, no provider calls, so the batching rules are testable
 * on their own, following the `streakService.applyStreakActivity` pattern.
 *
 * @returns {{contextMode: string, totalQuestions: number, types: string[], batches: Array<{id: string, counts: Record<string, number>, count: number, weight: number, startIndex: number}>}}
 */
export function buildGenerationPlan({ numQuestions, typeMix, notes } = {}) {
  const requested = Array.isArray(typeMix) && typeMix.length > 0 ? typeMix : QUESTION_TYPES;
  // Dedupe while keeping caller order: request validation permits `['mcq', 'mcq']`, and a
  // duplicate would otherwise double-count that type's share.
  const types = [...new Set(requested)];
  const total = Math.max(0, Number(numQuestions) || 0);

  return {
    contextMode: pickContextMode(notes),
    totalQuestions: total,
    types,
    batches: planBatches(countByType(total, types)),
  };
}
