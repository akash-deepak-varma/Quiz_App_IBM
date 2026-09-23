import { QUESTION_TYPES } from '../constants/enums.js';
import {
  SYSTEM_PREAMBLE,
  JSON_ONLY_RULE,
  MATH_FORMATTING_RULE,
  CODE_FORMATTING_RULE,
  EXPLANATION_QUALITY_RULES,
  RESPONSE_SHAPE,
  pedagogyRules,
} from './prompts/common.js';
import { buildTypeRules } from './prompts/typeRules.js';
import { buildDifficultyRules } from './prompts/difficultyRules.js';

// Shared by claudeProvider.js and openaiProvider.js. Neither real provider depends on
// Claude tool-use or OpenAI's `response_format: json_object` -- unconfirmed whether
// ICA's gateway supports either, and the sampled GPT model likely doesn't support JSON
// mode even on the real OpenAI API. Prompt-instructed strict JSON is more portable.
export function extractJsonFromText(text) {
  if (typeof text !== 'string') {
    throw new Error('extractJsonFromText expected a string');
  }

  const trimmed = text.trim();

  // Best case: provider followed instructions and returned pure JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through for providers that add surrounding prose/fences.
  }

  // Only strip a markdown fence if it surrounds the ENTIRE response.
  let candidate = trimmed;

  const outerFence = trimmed.match(
    /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i
  );

  if (outerFence) {
    candidate = outerFence[1].trim();

    try {
      return JSON.parse(candidate);
    } catch {
      // Fall through to extraction below.
    }
  }

  // Find JSON object boundaries in the full response.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in provider response');
  }

  const jsonText = candidate.slice(start, end + 1);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('[AI] Failed to parse provider JSON', {
      message: error.message,
      responsePreview: candidate.slice(0, 500),
    });

    throw new Error(
      `Invalid JSON in provider response: ${error.message}`,
      { cause: error }
    );
  }
}

// Prompt fragments live in ./prompts/*. This module stays the single import surface for both real
// providers (and promptUtils.test.js), so the split is invisible to callers.
export { MATH_FORMATTING_RULE, CODE_FORMATTING_RULE, RESPONSE_SHAPE } from './prompts/common.js';
export { TYPE_RULES, buildTypeRules } from './prompts/typeRules.js';
export { DIFFICULTY_RULES, buildDifficultyRules } from './prompts/difficultyRules.js';

/** How many "already covered" prompts to quote back. Enough to steer away from repeats, small
 *  enough that the hint cannot itself become the thing that overflows the output budget. */
const MAX_AVOID_HINTS = 12;
const AVOID_HINT_MAX_CHARS = 160;

/**
 * Describe the batch's request precisely. `typeCounts` ("2 mcq, 1 debug") beats the old
 * "cycle through these types as needed", which left the split to the model and made the returned
 * type mix unverifiable.
 */
function describeRequest({ numQuestions, types, typeCounts }) {
  if (typeCounts && Object.keys(typeCounts).length > 0) {
    const parts = Object.entries(typeCounts).map(([type, count]) => `${count} x "${type}"`);
    return `Generate exactly ${numQuestions} quiz question(s): ${parts.join(', ')}.`;
  }
  return [
    `Generate exactly ${numQuestions} quiz question(s).`,
    `Use only these question types, cycling through them as needed: ${types.join(', ')}.`,
  ].join('\n');
}

/**
 * @param {object} params
 * @param {string[]} [params.typeMix]        types this batch may return
 * @param {Record<string, number>} [params.typeCounts]  exact per-type counts for this batch
 * @param {number} [params.startIndex]       position of this batch within the whole quiz
 * @param {string[]} [params.avoidPrompts]   prompts already accepted elsewhere in this quiz
 * @param {string|null} [params.correction]  what went wrong with the previous attempt
 */
export function buildQuizGenerationPrompt({
  topic,
  notes,
  difficulty,
  numQuestions,
  typeMix,
  typeCounts,
  startIndex = 0,
  totalQuestions,
  avoidPrompts,
  correction,
}) {
  const types = Array.isArray(typeMix) && typeMix.length > 0 ? typeMix : QUESTION_TYPES;

  const system = [
    SYSTEM_PREAMBLE,
    JSON_ONLY_RULE,
    buildTypeRules(types),
    pedagogyRules({ multipleTypes: types.length > 1 }),
    buildDifficultyRules(difficulty),
    EXPLANATION_QUALITY_RULES,
    // Only send the formatting rules a batch of these types could actually need.
    MATH_FORMATTING_RULE,
    CODE_FORMATTING_RULE,
  ].join('\n\n');

  const hints = Array.isArray(avoidPrompts) ? avoidPrompts.filter(Boolean).slice(-MAX_AVOID_HINTS) : [];

  const user = [
    // A correction goes first: it is the one instruction that differs from the failed attempt,
    // and burying it under the boilerplate is how the old blind retry effectively ignored it.
    correction ? `IMPORTANT -- correcting a previous failed attempt: ${correction}` : null,
    `${describeRequest({ numQuestions, types, typeCounts })} Topic: "${topic}".`,
    `Difficulty: ${difficulty}.`,
    totalQuestions && totalQuestions > numQuestions
      ? `These are questions ${startIndex + 1}-${startIndex + numQuestions} of a ${totalQuestions}-question quiz on this topic.`
      : null,
    notes
      ? `The learner provided these notes. Use them to infer the concepts they're studying and ` +
        `write questions that test understanding of those concepts -- do NOT just turn ` +
        `individual sentences from the notes into direct recall questions:\n${notes}`
      : null,
    hints.length > 0
      ? `These questions are already covered elsewhere in this quiz -- ask about something different:\n${hints
          .map((prompt) => `- ${String(prompt).slice(0, AVOID_HINT_MAX_CHARS)}`)
          .join('\n')}`
      : null,
    'Every question should require some reasoning, however small -- avoid pure lookup/definition questions when a deeper version is possible.',
    '',
    'Respond with exactly this JSON shape:',
    RESPONSE_SHAPE,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

export function buildGradeShortAnswerPrompt({ prompt, rubric, correctAnswer, userAnswer }) {
  const system = [
    'You are grading a short-answer quiz response for a developer learning app.',
    'Respond with ONLY a single valid JSON object: {"isCorrect": boolean, "score": number between 0 and 1, "feedback": "one short sentence for the learner"}.',
    'No markdown code fences, no commentary before or after.',
  ].join('\n');

  const user = [
    `Question: ${prompt}`,
    `Reference/expected answer: ${correctAnswer}`,
    rubric ? `Rubric: ${rubric}` : null,
    `Learner's answer: ${userAnswer}`,
    '',
    "Grade the learner's answer for correctness against the reference answer (and rubric, if given). Partial credit is fine when the answer is only partially correct.",
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

// Used only as a fallback after a comment/whitespace-normalized exact-match comparison
// has already failed (see quizScoringService.js#scoreAnswer) -- this is for recognizing
// a functionally correct but differently-written solution, not the primary grading path.
export function buildGradeCodePrompt({ prompt, starterCode, correctAnswer, userAnswer }) {
  const system = [
    'You are grading a code-completion/debugging quiz response for a developer learning app.',
    "Judge the learner's code by functional correctness against the reference solution. Do NOT penalize differences in comments, formatting, whitespace, variable/parameter names, or alternative-but-equivalent logic that still satisfies the stated requirement.",
    'Respond with ONLY a single valid JSON object: {"isCorrect": boolean, "score": number between 0 and 1, "feedback": "one short sentence for the learner"}.',
    'No markdown code fences, no commentary before or after.',
  ].join('\n');

  const user = [
    `Question: ${prompt}`,
    starterCode ? `Starter code given to the learner:\n${starterCode}` : null,
    `Reference correct solution:\n${correctAnswer}`,
    `Learner's submitted code:\n${userAnswer}`,
    '',
    "Decide whether the learner's code correctly solves the stated problem, even if it differs stylistically from the reference solution.",
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

function formatAnswerForPrompt(answer) {
  if (answer === null || answer === undefined) return '(no answer given)';
  if (Array.isArray(answer)) return answer.join(' -> ');
  return String(answer);
}

// Personalized mistake-explanation prompt (Part 2) -- distinct from buildGrade*Prompt above:
// those score/grade an answer, this one explains a wrong answer that has already been graded.
export function buildExplainMistakePrompt({
  type,
  prompt,
  options,
  starterCode,
  correctAnswer,
  explanation,
  userAnswer,
}) {
  const system = [
    'You are a patient, encouraging tutor for a developer learning app, helping a learner ' +
      'understand a quiz question they answered incorrectly.',
    'Respond with ONLY a single valid JSON object: {"explanation": "string"}. No markdown code fences, no commentary before or after.',
    'In the explanation: (1) name the specific misconception likely behind THIS answer (not a generic wrong-answer explanation), (2) contrast it with the correct reasoning, (3) end with one concrete, memorable takeaway. Keep it focused -- a short paragraph, not an essay.',
    MATH_FORMATTING_RULE,
    CODE_FORMATTING_RULE,
  ].join('\n');

  const user = [
    `Question type: ${type}`,
    `Question: ${prompt}`,
    options ? `Options offered: ${formatAnswerForPrompt(options)}` : null,
    starterCode ? `Starter code given to the learner:\n${starterCode}` : null,
    `The learner's answer (incorrect): ${formatAnswerForPrompt(userAnswer)}`,
    `Correct answer: ${formatAnswerForPrompt(correctAnswer)}`,
    `Original explanation already shown to the learner: ${explanation}`,
    '',
    "Explain why the learner's specific answer was wrong and help them understand the correct reasoning, going beyond just repeating the original explanation above.",
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
