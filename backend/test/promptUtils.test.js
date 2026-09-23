import { describe, it, expect } from 'vitest';
import { buildQuizGenerationPrompt, buildExplainMistakePrompt } from '../src/providers/promptUtils.js';
import { QUESTION_TYPES, DIFFICULTIES } from '../src/constants/enums.js';

describe('buildQuizGenerationPrompt', () => {
  it('includes the pedagogy/difficulty/quality rule sections in the system prompt', () => {
    const { system } = buildQuizGenerationPrompt({
      topic: 'Closures',
      difficulty: 'intermediate',
      numQuestions: 3,
    });

    expect(system).toMatch(/Pedagogy rules/i);
    expect(system).toMatch(/Difficulty calibration/i);
    expect(system).toMatch(/Explanation quality rules/i);
    expect(system).toMatch(/\$\.\.\.\$/); // math-formatting instruction present
  });

  it('keeps the JSON response-shape contract exactly as consumed by extractJsonFromText/validateQuizSchema', () => {
    const { user } = buildQuizGenerationPrompt({
      topic: 'Closures',
      difficulty: 'intermediate',
      numQuestions: 3,
    });

    const shapeBlock = JSON.stringify(
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

    expect(user).toContain(shapeBlock);
  });

  // Previously every call carried all six type rule sets and all three difficulty calibrations,
  // whatever it asked for.
  it('includes only the requested types\' rules', () => {
    const { system } = buildQuizGenerationPrompt({
      topic: 'Closures',
      difficulty: 'beginner',
      numQuestions: 2,
      typeMix: ['true_false'],
    });

    expect(system).toContain('"true_false"');
    expect(system).not.toContain('"code_completion"');
    expect(system).not.toContain('"debug"');
    expect(system).not.toContain('"ordering"');
  });

  it('includes only the requested difficulty calibration', () => {
    const { system } = buildQuizGenerationPrompt({
      topic: 'Closures',
      difficulty: 'advanced',
      numQuestions: 2,
      typeMix: ['mcq'],
    });

    expect(system).toMatch(/Difficulty calibration/);
    expect(system).toContain('"advanced":');
    expect(system).not.toContain('"beginner":');
    expect(system).not.toContain('"intermediate":');
  });

  it('falls back to every type and difficulty when neither is specified', () => {
    const { system } = buildQuizGenerationPrompt({ topic: 'T', numQuestions: 3 });

    for (const type of QUESTION_TYPES) expect(system).toContain(`"${type}"`);
    for (const level of DIFFICULTIES) expect(system).toContain(`"${level}":`);
  });

  it('drops the type-distribution instruction for a single-type batch', () => {
    const single = buildQuizGenerationPrompt({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 2,
      typeMix: ['mcq'],
    });
    const mixed = buildQuizGenerationPrompt({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 2,
      typeMix: ['mcq', 'debug'],
    });

    expect(single.system).not.toMatch(/Distribute the requested question types/);
    expect(mixed.system).toMatch(/Distribute the requested question types/);
  });

  it('states exact per-type counts when the batch specifies them', () => {
    const { user } = buildQuizGenerationPrompt({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 3,
      typeMix: ['mcq', 'debug'],
      typeCounts: { mcq: 2, debug: 1 },
    });

    expect(user).toContain('2 x "mcq"');
    expect(user).toContain('1 x "debug"');
    expect(user).not.toMatch(/cycling through them as needed/);
  });

  it('leads with the correction when retrying a failed attempt', () => {
    const { user } = buildQuizGenerationPrompt({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 1,
      typeMix: ['mcq'],
      correction: 'questions[0].explanation must be a non-empty string',
    });

    expect(user.split('\n')[0]).toMatch(/correcting a previous failed attempt/i);
    expect(user).toContain('questions[0].explanation');
  });

  it('quotes already-covered prompts so a batch does not repeat them', () => {
    const { user } = buildQuizGenerationPrompt({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 1,
      typeMix: ['mcq'],
      avoidPrompts: ['What is a closure?'],
      startIndex: 4,
      totalQuestions: 10,
    });

    expect(user).toContain('What is a closure?');
    expect(user).toContain('questions 5-5 of a 10-question quiz');
  });
});

describe('buildExplainMistakePrompt', () => {
  it('includes the learner\'s actual wrong answer and the correct answer in the user prompt', () => {
    const { system, user } = buildExplainMistakePrompt({
      type: 'mcq',
      prompt: 'What is 2 + 2?',
      options: ['3', '4', '5'],
      starterCode: null,
      correctAnswer: '4',
      explanation: 'Basic addition.',
      userAnswer: '5',
    });

    expect(user).toContain('5');
    expect(user).toContain('4');
    expect(system).toMatch(/\{"explanation": "string"\}/);
  });
});
