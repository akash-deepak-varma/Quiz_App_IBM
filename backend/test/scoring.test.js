import { describe, it, expect, vi } from 'vitest';
import { scoreExactMatch, scoreAnswer, computeAttemptScore } from '../src/services/quizScoringService.js';
import { getProvider } from '../src/providers/index.js';

describe('scoreExactMatch', () => {
  it('scores single-answer mcq correctly', () => {
    const q = { type: 'mcq', correctAnswer: 'Option B' };
    expect(scoreExactMatch(q, 'Option B')).toEqual({ isCorrect: true, scoreFraction: 1 });
    expect(scoreExactMatch(q, 'Option A')).toEqual({ isCorrect: false, scoreFraction: 0 });
  });

  it('scores multi-answer mcq as all-or-nothing', () => {
    const q = { type: 'mcq', correctAnswer: ['A', 'B'] };
    expect(scoreExactMatch(q, ['B', 'A'])).toEqual({ isCorrect: true, scoreFraction: 1 });
    expect(scoreExactMatch(q, ['A'])).toEqual({ isCorrect: false, scoreFraction: 0 });
    expect(scoreExactMatch(q, ['A', 'B', 'C'])).toEqual({ isCorrect: false, scoreFraction: 0 });
  });

  it('scores true_false case-insensitively', () => {
    const q = { type: 'true_false', correctAnswer: 'true' };
    expect(scoreExactMatch(q, 'True')).toEqual({ isCorrect: true, scoreFraction: 1 });
    expect(scoreExactMatch(q, 'false')).toEqual({ isCorrect: false, scoreFraction: 0 });
  });

  it('scores ordering as an exact sequence match, not just a set match', () => {
    const q = { type: 'ordering', correctAnswer: ['A', 'B', 'C'] };
    expect(scoreExactMatch(q, ['A', 'B', 'C'])).toEqual({ isCorrect: true, scoreFraction: 1 });
    expect(scoreExactMatch(q, ['B', 'A', 'C'])).toEqual({ isCorrect: false, scoreFraction: 0 });
  });

  it('scores code_completion/debug via whitespace-normalized exact match on the full code', () => {
    const q = { type: 'code_completion', correctAnswer: 'function add(a, b) {\n  return a + b;\n}' };
    expect(scoreExactMatch(q, 'function add(a, b) {\n  return a + b;\n}')).toEqual({
      isCorrect: true,
      scoreFraction: 1,
    });
    expect(scoreExactMatch(q, 'function add(a, b) {   return a + b;   }')).toEqual({
      isCorrect: true,
      scoreFraction: 1,
    });
    expect(scoreExactMatch(q, 'function add(a, b) { return a - b; }')).toEqual({
      isCorrect: false,
      scoreFraction: 0,
    });
  });

  it('ignores comments left over from starter code (e.g. a retained TODO)', () => {
    const q = {
      type: 'code_completion',
      correctAnswer: 'class Dog:\n    def __init__(self, name):\n        self.name = name',
    };
    expect(
      scoreExactMatch(
        q,
        'class Dog:\n    def __init__(self, name):\n        # TODO: store name as an instance attribute\n        self.name = name'
      )
    ).toEqual({ isCorrect: true, scoreFraction: 1 });
  });

  it('ignores // line comments and /* block */ comments', () => {
    const q = { type: 'debug', correctAnswer: 'function sum(arr) {\n  let total = 0;\n  return total;\n}' };
    expect(
      scoreExactMatch(q, 'function sum(arr) {\n  let total = 0; // start at zero\n  return total;\n}')
    ).toEqual({ isCorrect: true, scoreFraction: 1 });
    expect(
      scoreExactMatch(q, 'function sum(arr) {\n  /* start at zero */\n  let total = 0;\n  return total;\n}')
    ).toEqual({ isCorrect: true, scoreFraction: 1 });
  });

  it('does not strip # or // when they appear inside a string literal', () => {
    const q = { type: 'code_completion', correctAnswer: 'const color = "#000000";' };
    expect(scoreExactMatch(q, 'const color = "#000000";')).toEqual({ isCorrect: true, scoreFraction: 1 });
    expect(scoreExactMatch(q, 'const color = "#ffffff";')).toEqual({ isCorrect: false, scoreFraction: 0 });

    const q2 = { type: 'code_completion', correctAnswer: 'const url = "http://example.com";' };
    expect(scoreExactMatch(q2, 'const url = "http://example.com";')).toEqual({ isCorrect: true, scoreFraction: 1 });
  });

  it('throws for short_answer, which must be routed to the AI provider instead', () => {
    const q = { type: 'short_answer', correctAnswer: 'x' };
    expect(() => scoreExactMatch(q, 'x')).toThrow();
  });
});

describe('computeAttemptScore', () => {
  it('averages score fractions', () => {
    expect(computeAttemptScore([1, 1, 0, 0])).toBe(0.5);
    expect(computeAttemptScore([1, 0.5, 0])).toBeCloseTo(0.5);
    expect(computeAttemptScore([])).toBe(0);
  });

  it('lets short-answer partial credit move the score away from a plain correct-count ratio', () => {
    const fractions = [1, 1, 0.5]; // 2 fully correct + 1 half-credit short answer
    const score = computeAttemptScore(fractions);
    expect(score).toBeCloseTo(2.5 / 3);
    expect(score).not.toBeCloseTo(2 / 3, 5);
  });
});

describe('scoreAnswer', () => {
  it('delegates short_answer questions to provider.gradeShortAnswer', async () => {
    const provider = getProvider('mock');
    const question = { type: 'short_answer', prompt: 'Explain it', correctAnswer: 'closures capture variables' };

    const result = await scoreAnswer(question, 'closures capture variables from their scope', provider);

    expect(result.scoreFraction).toBeGreaterThan(0);
    expect(typeof result.aiFeedback).toBe('string');
  });

  it('routes every other type through scoreExactMatch with no AI feedback', async () => {
    const provider = getProvider('mock');
    const question = { type: 'true_false', correctAnswer: 'true' };

    const result = await scoreAnswer(question, 'true', provider);

    expect(result).toEqual({ isCorrect: true, scoreFraction: 1, aiFeedback: null });
  });

  it('does not call provider.gradeCode when the comment-stripped exact match already succeeds', async () => {
    const provider = getProvider('mock');
    const gradeCodeSpy = vi.spyOn(provider, 'gradeCode');
    const question = {
      type: 'code_completion',
      prompt: 'Complete the function.',
      starterCode: 'function add(a, b) {\n  // TODO\n}',
      correctAnswer: 'function add(a, b) {\n  return a + b;\n}',
    };

    const result = await scoreAnswer(
      question,
      'function add(a, b) {\n  // TODO\n  return a + b;\n}',
      provider
    );

    expect(result).toEqual({ isCorrect: true, scoreFraction: 1, aiFeedback: null });
    expect(gradeCodeSpy).not.toHaveBeenCalled();
  });

  it('falls back to provider.gradeCode for code_completion/debug when the exact match fails', async () => {
    const provider = getProvider('mock');
    const question = {
      type: 'code_completion',
      prompt: 'Complete the function.',
      starterCode: 'function add(a, b) {\n  // TODO\n}',
      correctAnswer: 'function add(a, b) {\n  return a + b;\n}',
    };

    const result = await scoreAnswer(question, 'function add(a, b) {\n  const sum = a + b;\n  return sum;\n}', provider);

    expect(result.isCorrect).toBe(false);
    expect(result.scoreFraction).toBe(0);
    expect(typeof result.aiFeedback).toBe('string');
    expect(result.aiFeedback.length).toBeGreaterThan(0);
  });
});
