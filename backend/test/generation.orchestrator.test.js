import { describe, it, expect } from 'vitest';
import { runGeneration, orderByTypeMix, GENERATION_STATUS } from '../src/services/generation/orchestrator.js';
import { buildGenerationPlan } from '../src/services/generation/planner.js';
import { createMemoryStore } from '../src/services/generation/stores.js';
import { FAILURE_CATEGORIES } from '../src/services/generation/failureCategory.js';
import { TruncatedResponseError } from '../src/lib/errors.js';
import { mapWithConcurrency } from '../src/services/generation/pool.js';

const REQUEST = { topic: 'Closures', difficulty: 'beginner', numQuestions: 4, typeMix: ['true_false'] };

let promptCounter = 0;
function question(type = 'true_false', prompt = `unique prompt ${(promptCounter += 1)}`) {
  const base = { type, prompt, options: null, starterCode: null, explanation: 'because' };
  if (type === 'true_false') return { ...base, options: ['true', 'false'], correctAnswer: 'true' };
  if (type === 'mcq') return { ...base, options: ['A', 'B'], correctAnswer: 'A' };
  if (type === 'debug') return { ...base, starterCode: 'let x;', correctAnswer: 'let x = 0;' };
  return { ...base, correctAnswer: 'answer' };
}

/** A provider whose `generateQuiz` is driven by a scripted handler, recording every call. */
function fakeProvider(handler) {
  const calls = [];
  return {
    name: 'fake',
    calls,
    async generateQuiz(params) {
      calls.push(params);
      return handler(params, calls.length);
    },
  };
}

/** Honest provider: returns exactly what each batch asked for. */
function honestProvider() {
  return fakeProvider((params) =>
    Promise.resolve({
      topic: params.topic,
      difficulty: params.difficulty,
      questions: Object.entries(params.typeCounts).flatMap(([type, count]) =>
        Array.from({ length: count }, () => question(type))
      ),
    })
  );
}

async function run(provider, request = REQUEST, overrides = {}) {
  const plan = buildGenerationPlan(request);
  const store = createMemoryStore();
  const result = await runGeneration({ request, plan, provider, store, ...overrides });
  return { result, store, plan };
}

describe('runGeneration -- happy path', () => {
  it('produces the requested questions and reports READY', async () => {
    const provider = honestProvider();
    const { result } = await run(provider);

    expect(result.status).toBe(GENERATION_STATUS.READY);
    expect(result.questions).toHaveLength(4);
    expect(result.generated).toBe(4);
    expect(result.failureCategory).toBeNull();
  });

  it('persists accepted questions through the store as they arrive', async () => {
    const provider = honestProvider();
    const { store } = await run(provider);
    expect(store.snapshot().questions).toHaveLength(4);
    expect(store.snapshot().attempts).toHaveLength(1);
  });
});

describe('runGeneration -- per-item salvage', () => {
  it('keeps the valid questions from a batch that also contained invalid ones', async () => {
    const provider = fakeProvider((params, call) => {
      if (call === 1) {
        return {
          questions: [
            question('true_false', 'kept a'),
            { type: 'true_false', prompt: 'broken', options: ['true', 'false'] }, // no explanation
            question('true_false', 'kept b'),
            { type: 'nonsense', prompt: 'also broken' },
          ],
        };
      }
      return { questions: [question('true_false', 'kept c'), question('true_false', 'kept d')] };
    });

    const { result } = await run(provider);

    expect(result.status).toBe(GENERATION_STATUS.READY);
    expect(result.questions.map((q) => q.prompt)).toEqual(['kept a', 'kept b', 'kept c', 'kept d']);
    // Second call asked only for the two missing questions, not all four.
    expect(provider.calls[1]).toMatchObject({ numQuestions: 2, typeCounts: { true_false: 2 } });
  });

  it('feeds the schema violation back into the retry prompt', async () => {
    const provider = fakeProvider((params, call) =>
      call === 1
        ? { questions: [{ type: 'true_false', prompt: 'broken', options: ['true', 'false'] }] }
        : { questions: [question('true_false')] }
    );

    await run(provider, { ...REQUEST, numQuestions: 1 });

    expect(provider.calls[0].correction).toBeNull();
    expect(provider.calls[1].correction).toMatch(/schema validation/i);
    expect(provider.calls[1].correction).toMatch(/explanation/);
  });

  it('never re-runs a batch that already succeeded', async () => {
    // Two batches: the first succeeds, the second needs one retry. The first must not be redone.
    const request = { ...REQUEST, numQuestions: 10 }; // true_false batchSize 5 => 2 batches
    let failedOnce = false;
    const provider = fakeProvider((params) => {
      if (params.startIndex === 5 && !failedOnce) {
        failedOnce = true;
        return { questions: [] };
      }
      return {
        questions: Array.from({ length: params.numQuestions }, () => question('true_false')),
      };
    });

    const { result } = await run(provider, request);

    expect(result.status).toBe(GENERATION_STATUS.READY);
    expect(provider.calls).toHaveLength(3); // 2 batches + 1 retry, not 4
  });
});

describe('runGeneration -- retry ladder', () => {
  it('splits rather than resending an identical prompt when the response was truncated', async () => {
    const request = { ...REQUEST, numQuestions: 4 };
    const provider = fakeProvider((params) => {
      if (params.numQuestions === 4) throw new TruncatedResponseError();
      return {
        questions: Array.from({ length: params.numQuestions }, () => question('true_false')),
      };
    });

    const { result } = await run(provider, request);

    expect(result.status).toBe(GENERATION_STATUS.READY);
    const retried = provider.calls.slice(1).map((c) => c.numQuestions);
    expect(retried).toEqual([2, 2]); // halved, not repeated at 4
    // A split must never reuse question indices -- the mock provider numbers prompts from them.
    const starts = provider.calls.map((c) => c.startIndex);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('splits a truncated multi-type batch by type', async () => {
    const request = { topic: 'T', difficulty: 'beginner', numQuestions: 3, typeMix: ['mcq', 'debug'] };
    const provider = fakeProvider((params) => {
      if (Object.keys(params.typeCounts).length > 1) throw new TruncatedResponseError();
      return Promise.resolve({
        questions: Object.entries(params.typeCounts).flatMap(([type, count]) =>
          Array.from({ length: count }, () => question(type))
        ),
      });
    });

    const { result } = await run(provider, request);

    expect(result.status).toBe(GENERATION_STATUS.READY);
    expect(provider.calls.slice(1).every((c) => Object.keys(c.typeCounts).length === 1)).toBe(true);
  });

  it('isolates the remainder into single-question requests on the final attempt', async () => {
    const provider = fakeProvider(() => ({ questions: [] }));
    const { result } = await run(provider, { ...REQUEST, numQuestions: 4 }, { maxAttempts: 3 });

    expect(result.status).toBe(GENERATION_STATUS.FAILED);
    const sizes = provider.calls.map((c) => c.numQuestions);
    expect(sizes.slice(0, 2)).toEqual([4, 4]);
    expect(sizes.slice(2)).toEqual([1, 1, 1, 1]); // split to singles for the last attempt
  });

  it('retries a transient provider failure with the same request', async () => {
    const provider = fakeProvider((params, call) => {
      if (call === 1) {
        const err = new Error('rate limited');
        err.status = 429;
        throw err;
      }
      return {
        questions: Array.from({ length: params.numQuestions }, () => question('true_false')),
      };
    });

    const { result, store } = await run(provider);

    expect(result.status).toBe(GENERATION_STATUS.READY);
    expect(provider.calls[1].numQuestions).toBe(4); // unchanged -- nothing was wrong with the ask
    expect(store.snapshot().attempts[0].failureCategory).toBe(FAILURE_CATEGORIES.PROVIDER_RATE_LIMIT);
  });

  it('does not retry a non-rate-limit 4xx, which cannot succeed on a repeat', async () => {
    const provider = fakeProvider(() => {
      const err = new Error('invalid request');
      err.status = 400;
      throw err;
    });

    const { result } = await run(provider);

    expect(result.status).toBe(GENERATION_STATUS.FAILED);
    expect(result.failureCategory).toBe(FAILURE_CATEGORIES.PROVIDER_4XX);
    expect(provider.calls).toHaveLength(1);
  });

  it('bounds total attempts on a permanently failing provider', async () => {
    const provider = fakeProvider(() => {
      throw new Error('always broken');
    });
    const { result } = await run(provider, { ...REQUEST, numQuestions: 20 });

    expect(result.status).toBe(GENERATION_STATUS.FAILED);
    expect(result.questions).toEqual([]);
    expect(provider.calls.length).toBeLessThan(60);
  });
});

describe('runGeneration -- dedupe and partial results', () => {
  it('rejects a duplicate prompt and asks again instead of accepting it', async () => {
    let call = 0;
    const provider = fakeProvider(() => {
      call += 1;
      if (call === 1) return { questions: [question('true_false', 'same'), question('true_false', 'same')] };
      return { questions: [question('true_false', 'different')] };
    });

    const { result } = await run(provider, { ...REQUEST, numQuestions: 2 });

    expect(result.questions.map((q) => q.prompt)).toEqual(['same', 'different']);
  });

  it('treats prompts differing only in whitespace and case as duplicates', async () => {
    const provider = fakeProvider((params, call) =>
      call === 1
        ? { questions: [question('true_false', 'Is  this  the  same?')] }
        : { questions: [question('true_false', 'is this the same?')] }
    );

    const { result } = await run(provider, { ...REQUEST, numQuestions: 2 }, { maxAttempts: 2 });

    expect(result.status).toBe(GENERATION_STATUS.PARTIAL);
    expect(result.questions).toHaveLength(1);
  });

  it('shows already-accepted prompts to the provider as an avoid hint', async () => {
    const provider = fakeProvider((params, call) =>
      call === 1
        ? { questions: [question('true_false', 'first one')] }
        : { questions: Array.from({ length: params.numQuestions }, () => question('true_false')) }
    );

    await run(provider, { ...REQUEST, numQuestions: 2 });

    expect(provider.calls[0].avoidPrompts).toEqual([]);
    expect(provider.calls[1].avoidPrompts).toContain('first one');
  });

  it('reports PARTIAL with the questions it did get when it cannot reach the full count', async () => {
    const provider = fakeProvider((params, call) =>
      call === 1 ? { questions: [question('true_false', 'the only one')] } : { questions: [] }
    );

    const { result } = await run(provider);

    expect(result.status).toBe(GENERATION_STATUS.PARTIAL);
    expect(result.questions).toHaveLength(1);
    expect(result.generated).toBe(1);
    expect(result.failureCategory).toBeTruthy();
  });

  it('never returns more questions than requested even if the provider over-delivers', async () => {
    const provider = fakeProvider(() => ({
      questions: Array.from({ length: 9 }, () => question('true_false')),
    }));

    const { result } = await run(provider);
    expect(result.questions).toHaveLength(4);
  });
});

describe('runGeneration -- cancellation', () => {
  it('stops dispatching once the store reports cancellation', async () => {
    const provider = honestProvider();
    const plan = buildGenerationPlan({ ...REQUEST, numQuestions: 20 });
    const store = { ...createMemoryStore(), async isCancelled() { return true; } };

    const result = await runGeneration({ request: REQUEST, plan, provider, store });

    expect(result.status).toBe(GENERATION_STATUS.CANCELLED);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('runGeneration -- concurrency', () => {
  it('never exceeds the configured concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = fakeProvider(async (params) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { questions: Array.from({ length: params.numQuestions }, () => question('true_false')) };
    });

    const { result, plan } = await run(provider, { ...REQUEST, numQuestions: 20 }, { concurrency: 2 });

    expect(plan.batches.length).toBeGreaterThan(2);
    expect(result.status).toBe(GENERATION_STATUS.READY);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });
});

describe('orderByTypeMix', () => {
  it('interleaves types instead of clustering them by batch', () => {
    const questions = [
      question('mcq', 'm1'),
      question('mcq', 'm2'),
      question('debug', 'd1'),
      question('debug', 'd2'),
    ];
    expect(orderByTypeMix(questions, ['mcq', 'debug']).map((q) => q.prompt)).toEqual([
      'm1',
      'd1',
      'm2',
      'd2',
    ]);
  });

  it('drains remaining questions once a type runs out', () => {
    const questions = [question('mcq', 'm1'), question('debug', 'd1'), question('debug', 'd2')];
    expect(orderByTypeMix(questions, ['mcq', 'debug']).map((q) => q.prompt)).toEqual(['m1', 'd1', 'd2']);
  });

  it('keeps questions of an unrequested type rather than dropping them', () => {
    const questions = [question('mcq', 'm1'), question('true_false', 't1')];
    expect(orderByTypeMix(questions, ['mcq']).map((q) => q.prompt).sort()).toEqual(['m1', 't1']);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([30, 5, 20, 1], 4, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual([30, 5, 20, 1]);
  });

  it('returns an empty array for empty input without invoking the mapper', async () => {
    let called = false;
    expect(await mapWithConcurrency([], 3, async () => { called = true; })).toEqual([]);
    expect(called).toBe(false);
  });

  it('propagates the first rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })
    ).rejects.toThrow('boom');
  });
});
