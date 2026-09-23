import { DIFFICULTIES } from '../../constants/enums.js';

/**
 * One calibration line per difficulty. A request is for exactly one difficulty, so sending all
 * three -- as the previous single `DIFFICULTY_RULES` block did -- spent tokens describing two
 * calibrations the model must then ignore.
 */
export const DIFFICULTY_RULES = {
  beginner:
    '- "beginner": foundational, single-concept questions; distractors are clearly different ideas, not near-misses.',
  intermediate:
    '- "intermediate": combines two related concepts, or requires tracing through a short piece of logic/code; distractors reflect plausible partial understanding.',
  advanced:
    '- "advanced": edge cases, performance/design trade-offs, or subtle bugs; distractors reflect real, specific misconceptions an experienced learner could still fall for.',
};

export function buildDifficultyRules(difficulty) {
  const selected = DIFFICULTY_RULES[difficulty]
    ? [DIFFICULTY_RULES[difficulty]]
    : DIFFICULTIES.map((level) => DIFFICULTY_RULES[level]);

  return ['Difficulty calibration:', ...selected].join('\n');
}
