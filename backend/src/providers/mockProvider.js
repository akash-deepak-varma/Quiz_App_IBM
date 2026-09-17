import { QUESTION_TYPES } from '../constants/enums.js';

function buildQuestion(type, index, topic) {
  switch (type) {
    case 'mcq':
      return {
        type,
        prompt: `[Mock] Which of these best relates to "${topic}"? (#${index + 1})`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        starterCode: null,
        correctAnswer: 'Option B',
        explanation: 'Mock explanation: Option B is correct because this is fixture data, not a real AI response.',
      };
    case 'true_false':
      return {
        type,
        prompt: `[Mock] True or false: "${topic}" is the subject of this quiz. (#${index + 1})`,
        options: ['true', 'false'],
        starterCode: null,
        correctAnswer: 'true',
        explanation: 'Mock explanation: this statement is true by construction.',
      };
    case 'ordering':
      return {
        type,
        prompt: `[Mock] Put these steps for "${topic}" in the correct order. (#${index + 1})`,
        options: ['Step C', 'Step A', 'Step B'],
        starterCode: null,
        correctAnswer: ['Step A', 'Step B', 'Step C'],
        explanation: 'Mock explanation: the correct order is A, then B, then C, by construction.',
      };
    case 'short_answer':
      return {
        type,
        prompt: `[Mock] In your own words, explain one key idea behind "${topic}". (#${index + 1})`,
        options: null,
        starterCode: null,
        correctAnswer: 'key idea explanation',
        explanation: 'Mock explanation: any answer mentioning the key idea keywords earns credit.',
      };
    case 'code_completion':
      return {
        type,
        prompt: `[Mock] Complete the function so it returns the sum of two numbers. (#${index + 1})`,
        options: null,
        starterCode: 'function add(a, b) {\n  // TODO: return the sum\n}',
        // correctAnswer holds the FULL corrected code (matched against the user's whole
        // editor contents), not just the missing fragment -- see quizScoringService.js.
        correctAnswer: 'function add(a, b) {\n  return a + b;\n}',
        explanation: 'Mock explanation: the function body should return a + b.',
      };
    case 'debug':
      return {
        type,
        prompt: `[Mock] This function should total an array but returns NaN. Find and fix the bug. (#${index + 1})`,
        options: null,
        starterCode:
          'function sum(arr) {\n  let total;\n  for (let i = 0; i < arr.length; i++) {\n    total += arr[i];\n  }\n  return total;\n}',
        correctAnswer:
          'function sum(arr) {\n  let total = 0;\n  for (let i = 0; i < arr.length; i++) {\n    total += arr[i];\n  }\n  return total;\n}',
        explanation: 'Mock explanation: total is never initialized, so it starts as undefined and NaN propagates.',
      };
    default:
      throw new Error(`mockProvider has no fixture for question type "${type}"`);
  }
}

export async function generateQuiz({ topic, difficulty, numQuestions, typeMix }) {
  const types = Array.isArray(typeMix) && typeMix.length > 0 ? typeMix : QUESTION_TYPES;

  const questions = Array.from({ length: numQuestions }, (_, index) => {
    const type = types[index % types.length];
    return buildQuestion(type, index, topic);
  });

  return { topic, difficulty, questions };
}

export async function gradeShortAnswer({ correctAnswer, userAnswer }) {
  const normalize = (text) =>
    (text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

  const keywords = normalize(correctAnswer);
  const answerWords = new Set(normalize(userAnswer));
  const matched = keywords.filter((word) => answerWords.has(word));
  const score = keywords.length === 0 ? 0 : matched.length / keywords.length;

  return {
    isCorrect: score >= 0.5,
    score,
    feedback:
      score >= 0.5
        ? '[Mock] Your answer covers the key ideas.'
        : '[Mock] Your answer is missing some key ideas from the expected answer.',
  };
}

// Only ever called after quizScoringService's comment/whitespace-normalized exact match
// has already failed. The mock provider has no real semantic judge, so it must not
// fabricate a pass/fail on logic it can't evaluate -- it reports that honestly instead.
export async function gradeCode() {
  return {
    isCorrect: false,
    score: 0,
    feedback:
      "[Mock] This differs from the reference solution beyond comments/whitespace. Mock grading can't verify alternative-but-correct code -- configure a real AI provider (claude/openai) for semantic grading.",
  };
}

function formatAnswerForMock(answer) {
  if (answer === null || answer === undefined) return '(no answer given)';
  if (Array.isArray(answer)) return answer.join(' -> ');
  return String(answer);
}

export async function explainMistake({ correctAnswer, userAnswer }) {
  return {
    explanation:
      `[Mock] You answered "${formatAnswerForMock(userAnswer)}", but the correct answer is ` +
      `"${formatAnswerForMock(correctAnswer)}". Configure a real AI provider (claude/openai) for ` +
      'a personalized explanation of this mistake.',
  };
}
