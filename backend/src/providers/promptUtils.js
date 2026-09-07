import { QUESTION_TYPES } from '../constants/enums.js';

// Shared by claudeProvider.js and openaiProvider.js. Neither real provider depends on
// Claude tool-use or OpenAI's `response_format: json_object` -- unconfirmed whether
// ICA's gateway supports either, and the sampled GPT model likely doesn't support JSON
// mode even on the real OpenAI API. Prompt-instructed strict JSON is more portable.
export function extractJsonFromText(text) {
  if (typeof text !== 'string') {
    throw new Error('extractJsonFromText expected a string');
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in provider response');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

const TYPE_RULES = `
Question type rules:
- "mcq": options = 3-5 answer strings; correctAnswer = exactly one of those strings. Always single-select -- never an array, the UI has no way to indicate multi-select to the learner.
- "true_false": options = ["true", "false"]; correctAnswer = "true" or "false" (lowercase).
- "ordering": options = the steps/items in SHUFFLED order; correctAnswer = the same strings in the correct order (a permutation of options).
- "short_answer": options = null, starterCode = null; correctAnswer = a short reference answer (graded by rubric, not exact match).
- "code_completion": options = null; starterCode = a snippet with a gap for the learner to fill in; correctAnswer = the FULL corrected code (the whole function, not just the missing piece) -- it is compared against the learner's entire submitted code.
- "debug": options = null; starterCode = a snippet containing a deliberate bug; correctAnswer = the FULL fixed code (the whole function) -- compared against the learner's entire submitted code.
Every question needs a non-empty "explanation" string.
`.trim();

export function buildQuizGenerationPrompt({ topic, notes, difficulty, numQuestions, typeMix }) {
  const types = Array.isArray(typeMix) && typeMix.length > 0 ? typeMix : QUESTION_TYPES;

  const system = [
    'You are a quiz-generation engine for a developer learning app.',
    'Respond with ONLY a single valid JSON object. No markdown code fences, no commentary before or after, no trailing commas.',
    TYPE_RULES,
  ].join('\n\n');

  const user = [
    `Generate exactly ${numQuestions} quiz question(s) about: "${topic}".`,
    `Difficulty: ${difficulty}.`,
    `Use only these question types, cycling through them as needed: ${types.join(', ')}.`,
    notes ? `Base the questions on these learner notes where relevant:\n${notes}` : null,
    '',
    'Respond with exactly this JSON shape:',
    JSON.stringify(
      {
        topic: 'string',
        difficulty: 'beginner|intermediate|advanced',
        questions: [
          {
            type: 'one of the allowed types',
            prompt: 'string',
            options: 'string[] or null -- see type rules',
            starterCode: 'string or null -- see type rules',
            correctAnswer: 'string or string[] -- see type rules',
            explanation: 'string',
          },
        ],
      },
      null,
      2
    ),
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
