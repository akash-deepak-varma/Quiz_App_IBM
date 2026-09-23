// Prompt fragments that apply to every generation request regardless of type or difficulty.
// Split out of promptUtils.js so `buildQuizGenerationPrompt` can assemble only the slices a given
// batch actually needs -- it previously joined all six type rule sets and all three difficulty
// calibrations into every single call, including a one-question true/false request.

export const SYSTEM_PREAMBLE =
  'You are a quiz-generation engine for a developer learning app. Your goal is to help the ' +
  'learner genuinely understand the topic, not just test recall of facts.';

export const JSON_ONLY_RULE =
  'Respond with ONLY a single valid JSON object. No markdown code fences, no commentary before or after, no trailing commas.';

// Formatting instruction shared by generation and the mistake-explanation prompt so LaTeX
// written by either path actually renders (see frontend/src/components/MathText.jsx).
export const MATH_FORMATTING_RULE =
  'When a topic involves mathematical notation, write it as LaTeX using $...$ for inline math ' +
  'and $$...$$ for standalone equations -- the app renders this notation, so prefer it over ' +
  'ASCII math (x^2, sqrt(x)) or spelled-out symbols.';

// Formatting instruction shared by generation and the mistake-explanation prompt so code
// snippets mentioned in prose actually render specially (see MathText.jsx). This is about
// backticks INSIDE "prompt"/"explanation" string values only -- it must not be read as
// contradicting the "no markdown code fences" instruction about the outer JSON response.
export const CODE_FORMATTING_RULE =
  'When "prompt" or "explanation" text includes a code snippet, wrap inline code in single ' +
  'backticks (`like this`) and multi-line code in triple-backtick fences -- the app renders ' +
  'these specially. This applies only to backticks inside those string values, not to the ' +
  'overall JSON response itself, which must still have no surrounding markdown fences.';

const PEDAGOGY_BULLETS = [
  '- Prefer questions that require applying, comparing, or reasoning about a concept over questions that only ask "what is the definition of X".',
  '- Where the concept has a common misconception or a subtle "gotcha", design at least some questions around it -- that is where real understanding is built.',
  '- Vary the cognitive level across the quiz: mix straightforward recall with "why does this happen", "what would this produce", and "which approach is better and why" style questions.',
];

const DISTRIBUTE_TYPES_BULLET =
  '- Distribute the requested question types roughly evenly rather than clustering the same type together.';

/**
 * The type-distribution bullet is meaningless when a batch asks for one type, so it is included
 * only when it can actually be followed.
 */
export function pedagogyRules({ multipleTypes = true } = {}) {
  const bullets = multipleTypes ? [...PEDAGOGY_BULLETS, DISTRIBUTE_TYPES_BULLET] : PEDAGOGY_BULLETS;
  return [
    'Pedagogy rules -- the goal is for the learner to understand the concept, not just recall a fact:',
    ...bullets,
  ].join('\n');
}

export const EXPLANATION_QUALITY_RULES = `
Explanation quality rules -- "explanation" must teach, not just confirm the answer:
- State WHY the correct answer is correct, not only that it is.
- For mcq/true_false, briefly note why the most tempting wrong option is wrong (name the misconception it reflects).
- End with one short, concrete takeaway the learner can remember and reuse.
- Keep it focused: 2-4 sentences is usually enough -- depth, not length, is the goal.
`.trim();

// The exact response contract consumed by extractJsonFromText + validateQuizSchema. Kept as a
// single serialized literal because promptUtils.test.js asserts on it byte for byte.
export const RESPONSE_SHAPE = JSON.stringify(
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
);
