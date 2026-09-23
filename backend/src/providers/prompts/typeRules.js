import { QUESTION_TYPES } from '../../constants/enums.js';

/**
 * One rule line per question type, keyed so a batch can include only the types it asked for.
 *
 * Text is unchanged from the single `TYPE_RULES` block this replaces -- the only difference is
 * that a true/false batch no longer carries the code_completion and debug rules it cannot use.
 */
export const TYPE_RULES = {
  mcq: '- "mcq": options = 3-5 answer strings; correctAnswer = exactly one of those strings. Always single-select -- never an array, the UI has no way to indicate multi-select to the learner. Wrong options (distractors) should be plausible -- each one should reflect a real misconception, not an obviously-silly choice.',
  true_false:
    '- "true_false": options = ["true", "false"]; correctAnswer = "true" or "false" (lowercase). Avoid trivially-worded statements; the statement should require actually understanding the concept, not just spotting an extreme word like "always"/"never".',
  ordering:
    '- "ordering": options = the steps/items in SHUFFLED order; correctAnswer = the same strings in the correct order (a permutation of options). The steps should test understanding of a process or sequence, not arbitrary list order.',
  short_answer:
    '- "short_answer": options = null, starterCode = null; correctAnswer = a short reference answer (graded by rubric, not exact match). Ask for an explanation or reasoning, not a one-word fact lookup.',
  code_completion:
    '- "code_completion": options = null; starterCode = a snippet with a gap for the learner to fill in; correctAnswer = the FULL corrected code (the whole function, not just the missing piece) -- it is compared against the learner\'s entire submitted code.',
  debug:
    '- "debug": options = null; starterCode = a snippet containing a deliberate bug; correctAnswer = the FULL fixed code (the whole function) -- compared against the learner\'s entire submitted code. The bug should stem from a common, realistic misconception, not a typo.',
};

export function buildTypeRules(types) {
  const selected = (Array.isArray(types) && types.length > 0 ? types : QUESTION_TYPES).filter(
    (type) => TYPE_RULES[type]
  );
  const lines = selected.length > 0 ? selected : QUESTION_TYPES;

  return [
    'Question type rules:',
    ...lines.map((type) => TYPE_RULES[type]),
    'Every question needs a non-empty "explanation" string.',
  ].join('\n');
}
