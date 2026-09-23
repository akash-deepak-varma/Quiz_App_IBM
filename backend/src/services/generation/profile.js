/**
 * Per-type generation cost profile (solution.md section 5.1).
 *
 * `batchSize` is how many questions of that type belong in one LLM call; `weight` is that type's
 * relative output cost, used to pack several *small* type groups into one call instead of firing a
 * separate request per question. A true/false question is a sentence and a boolean; a debug
 * question is a broken code block plus a fix plus an explanation of the bug.
 */
export const QUESTION_GENERATION_PROFILE = {
  true_false: { batchSize: 5, weight: 1 },
  mcq: { batchSize: 4, weight: 2 },
  ordering: { batchSize: 4, weight: 2 },
  short_answer: { batchSize: 4, weight: 2 },
  code_completion: { batchSize: 2, weight: 4 },
  debug: { batchSize: 2, weight: 5 },
};

const DEFAULT_PROFILE = { batchSize: 4, weight: 2 };

export function profileFor(type) {
  return QUESTION_GENERATION_PROFILE[type] ?? DEFAULT_PROFILE;
}

/**
 * Packing limits for merged (multi-type) batches. Without merging, the default six-type mix at
 * ten questions would produce one call per question -- the "one LLM call per question" shape
 * problems.md section 26 explicitly warns against.
 */
export const BATCH_WEIGHT_BUDGET = 8;
export const MAX_BATCH_QUESTIONS = 5;

export function weightOf(counts) {
  return Object.entries(counts).reduce(
    (total, [type, count]) => total + profileFor(type).weight * count,
    0
  );
}

export function countOf(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}
