/**
 * @typedef {Object} GenerateQuizParams
 * @property {string} topic
 * @property {string} [notes]
 * @property {'beginner'|'intermediate'|'advanced'} difficulty
 * @property {number} numQuestions
 * @property {string[]} [typeMix] - subset of QUESTION_TYPES; providers should default to all types if omitted
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
 * Every AI provider module must export all of these:
 *   generateQuiz(params: GenerateQuizParams) => Promise<object>   raw, unvalidated quiz JSON
 *   gradeShortAnswer(params: GradeShortAnswerParams) => Promise<ShortAnswerGrade>
 *   gradeCode(params: GradeCodeParams) => Promise<CodeGrade>
 *
 * Providers only call the model and return/throw -- schema validation and retry
 * happen one layer up, in services/quizGenerationService.js.
 */
export const REQUIRED_PROVIDER_METHODS = ['generateQuiz', 'gradeShortAnswer', 'gradeCode'];
