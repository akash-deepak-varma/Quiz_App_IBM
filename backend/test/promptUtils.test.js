import { describe, it, expect } from 'vitest';
import { buildQuizGenerationPrompt, buildExplainMistakePrompt } from '../src/providers/promptUtils.js';

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
