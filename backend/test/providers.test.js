import { describe, it, expect, vi, afterEach } from 'vitest';
import { QUESTION_TYPES } from '../src/constants/enums.js';
import { validateQuizSchema } from '../src/validation/quizSchema.js';
import * as mockProvider from '../src/providers/mockProvider.js';
import { getProvider } from '../src/providers/index.js';
import { generateValidatedQuiz } from '../src/services/quizGenerationService.js';
import { QuizGenerationFailedError, UnsupportedProviderError } from '../src/lib/errors.js';

describe('mockProvider.generateQuiz', () => {
  it('produces schema-valid output for every question type individually', async () => {
    for (const type of QUESTION_TYPES) {
      const raw = await mockProvider.generateQuiz({
        topic: 'Test Topic',
        difficulty: 'beginner',
        numQuestions: 3,
        typeMix: [type],
      });
      const { valid, errors } = validateQuizSchema(raw);
      expect(errors).toEqual([]);
      expect(valid).toBe(true);
      expect(raw.questions.every((q) => q.type === type)).toBe(true);
    }
  });

  it.each([5, 20])('produces schema-valid output for numQuestions=%i with the default type mix', async (numQuestions) => {
    const raw = await mockProvider.generateQuiz({
      topic: 'Test Topic',
      difficulty: 'advanced',
      numQuestions,
    });
    expect(raw.questions).toHaveLength(numQuestions);
    const { valid, errors } = validateQuizSchema(raw);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});

describe('getProvider', () => {
  it('throws UnsupportedProviderError for an unknown provider name', () => {
    expect(() => getProvider('not-a-real-provider')).toThrow(UnsupportedProviderError);
  });

  it('resolves the mock provider when explicitly requested', () => {
    const provider = getProvider('mock');
    expect(provider.name).toBe('mock');
    expect(typeof provider.generateQuiz).toBe('function');
    expect(typeof provider.gradeShortAnswer).toBe('function');
  });

  it('defaults to mock when no override is given', () => {
    const provider = getProvider();
    expect(provider.name).toBe('mock');
  });
});

describe('generateValidatedQuiz', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries exactly once on invalid-then-valid and returns the valid result', async () => {
    const validQuiz = {
      topic: 'T',
      difficulty: 'beginner',
      questions: [
        {
          type: 'true_false',
          prompt: 'p',
          options: ['true', 'false'],
          starterCode: null,
          correctAnswer: 'true',
          explanation: 'e',
        },
      ],
    };
    const spy = vi
      .spyOn(mockProvider, 'generateQuiz')
      .mockResolvedValueOnce({ topic: 'T' }) // invalid: missing difficulty/questions
      .mockResolvedValueOnce(validQuiz);

    const result = await generateValidatedQuiz({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 1,
      provider: 'mock',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.quiz).toEqual(validQuiz);
    expect(result.providerUsed).toBe('mock');
  });

  it('throws QuizGenerationFailedError after two consecutively invalid attempts', async () => {
    const spy = vi.spyOn(mockProvider, 'generateQuiz').mockResolvedValue({ topic: 'T' });

    await expect(
      generateValidatedQuiz({ topic: 'T', difficulty: 'beginner', numQuestions: 1, provider: 'mock' })
    ).rejects.toThrow(QuizGenerationFailedError);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('getProvider default fallback (isolated)', () => {
  it('falls back to the literal "mock" default when env.aiProvider is not set', async () => {
    vi.resetModules();
    vi.doMock('../src/config/env.js', () => ({ env: { aiProvider: undefined } }));

    const { getProvider: getProviderWithNoEnv } = await import('../src/providers/index.js');
    const provider = getProviderWithNoEnv();

    expect(provider.name).toBe('mock');

    vi.doUnmock('../src/config/env.js');
    vi.resetModules();
  });
});
