export const QUESTION_TYPES = [
  'mcq',
  'code_completion',
  'debug',
  'short_answer',
  'ordering',
  'true_false',
];

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

// Full documented set of provider names the app understands. Which of these are
// actually callable right now is determined by providers/index.js's registry --
// this list is for request-param validation and frontend UI, not a runtime source of truth.
export const AI_PROVIDERS = ['mock', 'claude', 'openai'];

export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 20;
