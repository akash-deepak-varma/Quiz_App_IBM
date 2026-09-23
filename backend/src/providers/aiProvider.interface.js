/**
 * @typedef {Object} GenerateQuizParams
 * @property {string} topic
 * @property {string} [notes]
 * @property {'beginner'|'intermediate'|'advanced'} difficulty
 * @property {number} numQuestions
 * @property {string[]} [typeMix] - subset of QUESTION_TYPES; providers should default to all types if omitted
 * @property {Record<string, number>} [typeCounts] - exact per-type counts for this batch; overrides typeMix cycling
 * @property {number} [startIndex] - this batch's offset within the whole quiz; providers that number questions must honour it
 * @property {number} [totalQuestions] - size of the whole quiz, for context only
 * @property {string[]} [avoidPrompts] - prompts already accepted elsewhere in this quiz
 * @property {string|null} [correction] - what was wrong with the previous attempt, if this is a retry
 */

/**
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} structuredOutput - native JSON/tool-use schema enforcement available
 * @property {boolean} promptCaching
 * @property {boolean} streaming
 * @property {number} maxOutputTokens
 */

/**
 * @typedef {Object} GradeShortAnswerParams
 * @property {string} prompt
 * @property {string} [rubric]
 * @property {string} correctAnswer
 * @property {string} userAnswer
 */

/**
 * @typedef {Object} ShortAnswerGrade
 * @property {boolean} isCorrect
 * @property {number} score - 0..1
 * @property {string} feedback
 */

/**
 * @typedef {Object} GradeCodeParams
 * @property {string} prompt
 * @property {string} [starterCode]
 * @property {string} correctAnswer
 * @property {string} userAnswer
 */

/**
 * @typedef {Object} CodeGrade
 * @property {boolean} isCorrect
 * @property {number} score - 0..1
 * @property {string} feedback
 */

/**
 * @typedef {Object} ExplainMistakeParams
 * @property {string} type
 * @property {string} prompt
 * @property {string[]|null} [options]
 * @property {string|null} [starterCode]
 * @property {string|string[]} correctAnswer
 * @property {string} explanation
 * @property {*} userAnswer
 */

/**
 * @typedef {Object} MistakeExplanation
 * @property {string} explanation
 */

/**
 * Every AI provider module must export all of these:
 *   generateQuiz(params: GenerateQuizParams) => Promise<object>   raw, unvalidated quiz JSON
 *   gradeShortAnswer(params: GradeShortAnswerParams) => Promise<ShortAnswerGrade>
 *   gradeCode(params: GradeCodeParams) => Promise<CodeGrade>
 *   explainMistake(params: ExplainMistakeParams) => Promise<MistakeExplanation>
 *
 * Providers only call the model and return/throw -- batching, schema validation and the retry
 * ladder happen one layer up, in services/generation/.
 *
 * Optionally, each provider also exports:
 *   capabilities: ProviderCapabilities
 *
 * A provider that hits its own output-token limit should throw `TruncatedResponseError`
 * (lib/errors.js) rather than returning partial text, so the retry ladder splits the batch
 * instead of re-sending a request that cannot fit.
 */
export const REQUIRED_PROVIDER_METHODS = ['generateQuiz', 'gradeShortAnswer', 'gradeCode', 'explainMistake'];
