import { QUESTION_TYPES, DIFFICULTIES } from '../constants/enums.js';

const OPTIONS_TYPES = new Set(['mcq', 'true_false', 'ordering']);
const STARTER_CODE_TYPES = new Set(['code_completion', 'debug']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}

function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((item, i) => item === sortedB[i]);
}

export function validateQuestion(q, index, errors) {
  const prefix = `questions[${index}]`;

  if (!q || typeof q !== 'object') {
    errors.push(`${prefix} must be an object`);
    return;
  }

  if (!QUESTION_TYPES.includes(q.type)) {
    errors.push(`${prefix}.type must be one of ${QUESTION_TYPES.join(', ')}`);
  }
  if (!isNonEmptyString(q.prompt)) {
    errors.push(`${prefix}.prompt must be a non-empty string`);
  }
  if (!isNonEmptyString(q.explanation)) {
    errors.push(`${prefix}.explanation must be a non-empty string`);
  }

  const needsOptions = OPTIONS_TYPES.has(q.type);
  if (needsOptions) {
    if (!isStringArray(q.options) || q.options.length < 2) {
      errors.push(`${prefix}.options must be an array of at least 2 strings for type "${q.type}"`);
    }
  } else if (q.options !== null && q.options !== undefined) {
    errors.push(`${prefix}.options must be null for type "${q.type}"`);
  }

  const needsStarterCode = STARTER_CODE_TYPES.has(q.type);
  if (needsStarterCode) {
    if (!isNonEmptyString(q.starterCode)) {
      errors.push(`${prefix}.starterCode must be a non-empty string for type "${q.type}"`);
    }
  } else if (q.starterCode !== null && q.starterCode !== undefined) {
    errors.push(`${prefix}.starterCode must be null for type "${q.type}"`);
  }

  if (q.type === 'ordering') {
    if (!isStringArray(q.correctAnswer)) {
      errors.push(`${prefix}.correctAnswer must be an array of strings for type "ordering"`);
    } else if (isStringArray(q.options) && !sameMultiset(q.correctAnswer, q.options)) {
      errors.push(`${prefix}.correctAnswer must be a permutation of options for type "ordering"`);
    }
  } else if (q.type === 'mcq') {
    const isSingle = isNonEmptyString(q.correctAnswer);
    const isMulti = isStringArray(q.correctAnswer);
    if (!isSingle && !isMulti) {
      errors.push(`${prefix}.correctAnswer must be a string or non-empty string array for type "mcq"`);
    } else if (isStringArray(q.options)) {
      const answers = isSingle ? [q.correctAnswer] : q.correctAnswer;
      const unknown = answers.filter((a) => !q.options.includes(a));
      if (unknown.length > 0) {
        errors.push(`${prefix}.correctAnswer contains values not present in options: ${unknown.join(', ')}`);
      }
    }
  } else {
    if (!isNonEmptyString(q.correctAnswer)) {
      errors.push(`${prefix}.correctAnswer must be a non-empty string for type "${q.type}"`);
    } else if (
      q.type === 'true_false' &&
      isStringArray(q.options) &&
      !q.options.includes(q.correctAnswer)
    ) {
      errors.push(`${prefix}.correctAnswer must be one of options for type "true_false"`);
    }
  }
}

export function validateQuizSchema(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Quiz payload must be an object'] };
  }

  if (!isNonEmptyString(raw.topic)) {
    errors.push('topic must be a non-empty string');
  }
  if (!DIFFICULTIES.includes(raw.difficulty)) {
    errors.push(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  }
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    errors.push('questions must be a non-empty array');
    return { valid: false, errors };
  }

  raw.questions.forEach((q, index) => validateQuestion(q, index, errors));

  return { valid: errors.length === 0, errors };
}
