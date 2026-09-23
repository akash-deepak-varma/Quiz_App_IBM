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

  const trueFalseQuestion = (prompt) => ({
    type: 'true_false',
    prompt,
    options: ['true', 'false'],
    starterCode: null,
    correctAnswer: 'true',
    explanation: 'e',
  });

  it('re-requests a batch that came back unusable and returns the recovered result', async () => {
    const validQuiz = {
      topic: 'T',
      difficulty: 'beginner',
      questions: [trueFalseQuestion('p')],
    };
    const spy = vi
      .spyOn(mockProvider, 'generateQuiz')
      .mockResolvedValueOnce({ topic: 'T' }) // unusable: no questions array at all
      .mockResolvedValueOnce(validQuiz);

    const result = await generateValidatedQuiz({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 1,
      typeMix: ['true_false'],
      provider: 'mock',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.quiz).toEqual(validQuiz);
    expect(result.providerUsed).toBe('mock');
  });

  // The old generator discarded a whole response if any question in it was malformed. Salvaging
  // the good ones and re-requesting only the shortfall is the core of the new design.
  it('keeps the valid questions from a partly-invalid batch and re-requests only the shortfall', async () => {
    const spy = vi
      .spyOn(mockProvider, 'generateQuiz')
      .mockResolvedValueOnce({
        topic: 'T',
        difficulty: 'beginner',
        questions: [
          trueFalseQuestion('good one'),
          { type: 'true_false', prompt: '', options: ['true', 'false'], correctAnswer: 'true' },
        ],
      })
      .mockResolvedValueOnce({
        topic: 'T',
        difficulty: 'beginner',
        questions: [trueFalseQuestion('recovered one')],
      });

    const result = await generateValidatedQuiz({
      topic: 'T',
      difficulty: 'beginner',
      numQuestions: 2,
      typeMix: ['true_false'],
      provider: 'mock',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    // Only the missing question was asked for the second time, not the whole batch.
    expect(spy.mock.calls[1][0]).toMatchObject({ numQuestions: 1, typeCounts: { true_false: 1 } });
    expect(result.quiz.questions.map((q) => q.prompt)).toEqual(['good one', 'recovered one']);
  });

  it('gives up on a batch after the configured attempt limit and fails the generation', async () => {
    const spy = vi.spyOn(mockProvider, 'generateQuiz').mockResolvedValue({ topic: 'T' });

    await expect(
      generateValidatedQuiz({
        topic: 'T',
        difficulty: 'beginner',
        numQuestions: 1,
        typeMix: ['true_false'],
        provider: 'mock',
      })
    ).rejects.toThrow(QuizGenerationFailedError);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  // A synchronous 201 promises exactly numQuestions questions, so a shortfall must still fail
  // loudly here. Partial results are the async job path's job.
  it('fails rather than returning fewer questions than requested', async () => {
    vi.spyOn(mockProvider, 'generateQuiz').mockResolvedValue({
      topic: 'T',
      difficulty: 'beginner',
      questions: [trueFalseQuestion('only one ever')],
    });

    await expect(
      generateValidatedQuiz({
        topic: 'T',
        difficulty: 'beginner',
        numQuestions: 3,
        typeMix: ['true_false'],
        provider: 'mock',
      })
    ).rejects.toThrow(QuizGenerationFailedError);
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
