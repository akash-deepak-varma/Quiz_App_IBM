import { BadRequestError } from '../lib/errors.js';
import { AI_PROVIDERS, DIFFICULTIES, MAX_QUESTIONS, MIN_QUESTIONS, QUESTION_TYPES } from '../constants/enums.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Notes are the one field that reaches an LLM prompt and, later, the results page, so they are
 * stripped of markup and hard-capped here rather than downstream.
 */
export function sanitizeNotes(notes) {
  if (typeof notes !== 'string') return null;
  const stripped = notes.replace(/<[^>]*>/g, '').trim().slice(0, 20000);
  return stripped || null;
}

/**
 * Validate and normalize a quiz-generation request body.
 *
 * Shared by the synchronous `POST /api/quiz/generate` and the asynchronous
 * `POST /api/quiz/generations`: the two endpoints differ in *when* they generate, and must not
 * differ in what they accept. Throws `BadRequestError` on the first problem found.
 */
export function parseGenerateRequest(body) {
  const { topic, notes, difficulty = 'beginner', numQuestions = 5, typeMix, provider, tags } = body || {};

  if (!isNonEmptyString(topic)) {
    throw new BadRequestError('topic is required');
  }
  if (!DIFFICULTIES.includes(difficulty)) {
    throw new BadRequestError(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  }
  const count = Number(numQuestions);
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    throw new BadRequestError(`numQuestions must be an integer between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}`);
  }
  if (typeMix !== undefined) {
    const isValidTypeMix =
      Array.isArray(typeMix) && typeMix.length > 0 && typeMix.every((t) => QUESTION_TYPES.includes(t));
    if (!isValidTypeMix) {
      throw new BadRequestError(`typeMix must be a non-empty array drawn from ${QUESTION_TYPES.join(', ')}`);
    }
  }
  if (provider !== undefined && !AI_PROVIDERS.includes(provider)) {
    throw new BadRequestError(`provider must be one of ${AI_PROVIDERS.join(', ')}`);
  }
  if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === 'string'))) {
    throw new BadRequestError('tags must be an array of strings');
  }

  return {
    topic: topic.trim(),
    notes: sanitizeNotes(notes),
    difficulty,
    numQuestions: count,
    typeMix,
    provider,
    tags: [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))],
  };
}
