import { QUESTION_TYPES } from '../constants/enums.js';

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

// Formatting instruction shared by generation and the mistake-explanation prompt so LaTeX
// written by either path actually renders (see frontend/src/components/MathText.jsx).
const MATH_FORMATTING_RULE =
  'When a topic involves mathematical notation, write it as LaTeX using $...$ for inline math ' +
  'and $$...$$ for standalone equations -- the app renders this notation, so prefer it over ' +
  'ASCII math (x^2, sqrt(x)) or spelled-out symbols.';

// Formatting instruction shared by generation and the mistake-explanation prompt so code
// snippets mentioned in prose actually render specially (see MathText.jsx). This is about
// backticks INSIDE "prompt"/"explanation" string values only -- it must not be read as
// contradicting the "no markdown code fences" instruction about the outer JSON response.
const CODE_FORMATTING_RULE =
  'When "prompt" or "explanation" text includes a code snippet, wrap inline code in single ' +
  'backticks (`like this`) and multi-line code in triple-backtick fences -- the app renders ' +
  'these specially. This applies only to backticks inside those string values, not to the ' +
  'overall JSON response itself, which must still have no surrounding markdown fences.';

const TYPE_RULES = `
Question type rules:
- "mcq": options = 3-5 answer strings; correctAnswer = exactly one of those strings. Always single-select -- never an array, the UI has no way to indicate multi-select to the learner. Wrong options (distractors) should be plausible -- each one should reflect a real misconception, not an obviously-silly choice.
- "true_false": options = ["true", "false"]; correctAnswer = "true" or "false" (lowercase). Avoid trivially-worded statements; the statement should require actually understanding the concept, not just spotting an extreme word like "always"/"never".
- "ordering": options = the steps/items in SHUFFLED order; correctAnswer = the same strings in the correct order (a permutation of options). The steps should test understanding of a process or sequence, not arbitrary list order.
- "short_answer": options = null, starterCode = null; correctAnswer = a short reference answer (graded by rubric, not exact match). Ask for an explanation or reasoning, not a one-word fact lookup.
- "code_completion": options = null; starterCode = a snippet with a gap for the learner to fill in; correctAnswer = the FULL corrected code (the whole function, not just the missing piece) -- it is compared against the learner's entire submitted code.
- "debug": options = null; starterCode = a snippet containing a deliberate bug; correctAnswer = the FULL fixed code (the whole function) -- compared against the learner's entire submitted code. The bug should stem from a common, realistic misconception, not a typo.
Every question needs a non-empty "explanation" string.
`.trim();

const PEDAGOGY_RULES = `
Pedagogy rules -- the goal is for the learner to understand the concept, not just recall a fact:
- Prefer questions that require applying, comparing, or reasoning about a concept over questions that only ask "what is the definition of X".
- Where the concept has a common misconception or a subtle "gotcha", design at least some questions around it -- that is where real understanding is built.
- Vary the cognitive level across the quiz: mix straightforward recall with "why does this happen", "what would this produce", and "which approach is better and why" style questions.
- Distribute the requested question types roughly evenly rather than clustering the same type together.
`.trim();

const DIFFICULTY_RULES = `
Difficulty calibration:
- "beginner": foundational, single-concept questions; distractors are clearly different ideas, not near-misses.
- "intermediate": combines two related concepts, or requires tracing through a short piece of logic/code; distractors reflect plausible partial understanding.
- "advanced": edge cases, performance/design trade-offs, or subtle bugs; distractors reflect real, specific misconceptions an experienced learner could still fall for.
`.trim();

const QUESTION_QUALITY_RULES = `
Explanation quality rules -- "explanation" must teach, not just confirm the answer:
- State WHY the correct answer is correct, not only that it is.
- For mcq/true_false, briefly note why the most tempting wrong option is wrong (name the misconception it reflects).
- End with one short, concrete takeaway the learner can remember and reuse.
- Keep it focused: 2-4 sentences is usually enough -- depth, not length, is the goal.
`.trim();

export function buildQuizGenerationPrompt({ topic, notes, difficulty, numQuestions, typeMix }) {
  const types = Array.isArray(typeMix) && typeMix.length > 0 ? typeMix : QUESTION_TYPES;

  const system = [
    'You are a quiz-generation engine for a developer learning app. Your goal is to help the ' +
      'learner genuinely understand the topic, not just test recall of facts.',
    'Respond with ONLY a single valid JSON object. No markdown code fences, no commentary before or after, no trailing commas.',
    TYPE_RULES,
    PEDAGOGY_RULES,
    DIFFICULTY_RULES,
    QUESTION_QUALITY_RULES,
    MATH_FORMATTING_RULE,
    CODE_FORMATTING_RULE,
  ].join('\n\n');

  const user = [
    `Generate exactly ${numQuestions} quiz question(s) about: "${topic}".`,
    `Difficulty: ${difficulty}.`,
    `Use only these question types, cycling through them as needed: ${types.join(', ')}.`,
    notes
      ? `The learner provided these notes. Use them to infer the concepts they're studying and ` +
        `write questions that test understanding of those concepts -- do NOT just turn ` +
        `individual sentences from the notes into direct recall questions:\n${notes}`
      : null,
    'Every question should require some reasoning, however small -- avoid pure lookup/definition questions when a deeper version is possible.',
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
