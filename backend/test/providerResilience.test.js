import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicCtor = vi.fn();
const openaiCtor = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(opts) {
      anthropicCtor(opts);
      this.messages = {
        create: vi
          .fn()
          .mockResolvedValue({ content: [{ type: 'text', text: '{"topic":"t","difficulty":"beginner","questions":[]}' }] }),
      };
    }
  },
}));

vi.mock('openai', () => ({
  default: class {
    constructor(opts) {
      openaiCtor(opts);
      this.chat = {
        completions: {
          create: vi
            .fn()
            .mockResolvedValue({ choices: [{ message: { content: '{"topic":"t","difficulty":"beginner","questions":[]}' } }] }),
        },
      };
    }
  },
}));

/**
 * Providers take their credentials as an argument now, so a test has to supply one. Building it
 * here rather than reading env is precisely the point of the change: there is no ambient key any
 * more, and a provider that tried to find one would fail this suite.
 *
 * A fresh object per call by default, because identity is what the client cache keys on -- see the
 * two cache tests at the bottom.
 */
const runtime = (over = {}) => ({
  provider: 'claude',
  apiKey: 'test-key',
  baseUrl: 'https://example.invalid',
  model: 'test-model',
  timeoutMs: 20_000,
  maxRetries: 2,
  fetch: globalThis.fetch,
  source: 'user',
  ...over,
});

const quizParams = { topic: 't', difficulty: 'beginner', numQuestions: 1 };

describe('claudeProvider / openaiProvider resilience wiring', () => {
  beforeEach(() => {
    anthropicCtor.mockClear();
    openaiCtor.mockClear();
  });

  it('constructs the Anthropic client with a bounded timeout and explicit maxRetries', async () => {
    const claudeProvider = await import('../src/providers/claudeProvider.js');
    await claudeProvider.generateQuiz(quizParams, runtime());

    expect(anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: expect.any(Number), maxRetries: expect.any(Number) })
    );
    const opts = anthropicCtor.mock.calls[0][0];
    expect(opts.timeout).toBeLessThan(600_000); // strictly less than the SDK's 10-minute default
    expect(opts.maxRetries).toBeGreaterThanOrEqual(0);
  });

  it('constructs the OpenAI client with a bounded timeout and explicit maxRetries', async () => {
    const openaiProvider = await import('../src/providers/openaiProvider.js');
    await openaiProvider.generateQuiz(quizParams, runtime());

    expect(openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: expect.any(Number), maxRetries: expect.any(Number) })
    );
    const opts = openaiCtor.mock.calls[0][0];
    expect(opts.timeout).toBeLessThan(600_000);
    expect(opts.maxRetries).toBeGreaterThanOrEqual(0);
  });

  it('propagates a transient SDK failure as a rejection rather than hanging', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        constructor() {
          this.messages = { create: vi.fn().mockRejectedValue(new Error('simulated 503')) };
        }
      },
    }));

    const claudeProvider = await import('../src/providers/claudeProvider.js');
    await expect(
      claudeProvider.generateQuiz(quizParams, runtime())
    ).rejects.toThrow('simulated 503');

    vi.doUnmock('@anthropic-ai/sdk');
  });

  // A response cut off at the token limit used to surface only as unparseable JSON, so the retry
  // asked for the same oversized batch and truncated again.
  it('reports a Claude response stopped at the token limit as a truncation, not a parse error', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        constructor() {
          this.messages = {
            create: vi.fn().mockResolvedValue({
              stop_reason: 'max_tokens',
              content: [{ type: 'text', text: '{"topic":"t","questions":[{"type":"mcq"' }],
            }),
          };
        }
      },
    }));

    const claudeProvider = await import('../src/providers/claudeProvider.js');
    const { TruncatedResponseError } = await import('../src/lib/errors.js');

    await expect(
      claudeProvider.generateQuiz({ ...quizParams, numQuestions: 20 }, runtime())
    ).rejects.toThrow(TruncatedResponseError);

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('reports an OpenAI response with finish_reason "length" as a truncation', async () => {
    vi.resetModules();
    vi.doMock('openai', () => ({
      default: class {
        constructor() {
          this.chat = {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [{ finish_reason: 'length', message: { content: '{"questions":[' } }],
              }),
            },
          };
        }
      },
    }));

    const openaiProvider = await import('../src/providers/openaiProvider.js');
    const { TruncatedResponseError } = await import('../src/lib/errors.js');

    await expect(
      openaiProvider.generateQuiz({ ...quizParams, numQuestions: 20 }, runtime())
    ).rejects.toThrow(TruncatedResponseError);

    vi.doUnmock('openai');
  });

  it('sends an explicit output-token cap to OpenAI, which previously had none', async () => {
    vi.resetModules();
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"topic":"t","difficulty":"beginner","questions":[]}' } }],
    });
    vi.doMock('openai', () => ({
      default: class {
        constructor() {
          this.chat = { completions: { create } };
        }
      },
    }));

    const openaiProvider = await import('../src/providers/openaiProvider.js');
    await openaiProvider.generateQuiz(quizParams, runtime());

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: expect.any(Number) }));

    vi.doUnmock('openai');
  });

  // These two replace a single older test that asserted "one client per process". That claim is now
  // wrong *by design*: one client per process would mean one user's Authorization header serving
  // another user's request, which is the bug the per-user credential work exists to remove. The
  // invariant worth pinning is one client per resolved runtime config.
  function mockAnthropicCtor() {
    const ctor = vi.fn();
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"topic":"t","difficulty":"beginner","questions":[]}' }],
    });
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        constructor(opts) {
          ctor(opts);
          this.messages = { create };
        }
      },
    }));
    return { ctor, create };
  }

  it('reuses one SDK client across calls that share a runtime config', async () => {
    vi.resetModules();
    const { ctor } = mockAnthropicCtor();

    const claudeProvider = await import('../src/providers/claudeProvider.js');
    // One config object, used twice -- which is what a single generation job does across all of its
    // batches, since it resolves its credentials once and getProvider closes over that object.
    const shared = runtime();
    await claudeProvider.generateQuiz(quizParams, shared);
    await claudeProvider.generateQuiz(quizParams, shared);

    // The WeakMap is keyed on the object, so this is the property the old process-wide memo was
    // really buying: no connection pool rebuilt per batch.
    expect(ctor).toHaveBeenCalledTimes(1);

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('constructs a separate client for a different runtime config, so two users never share one', async () => {
    vi.resetModules();
    const { ctor } = mockAnthropicCtor();

    const claudeProvider = await import('../src/providers/claudeProvider.js');
    await claudeProvider.generateQuiz(quizParams, runtime({ apiKey: 'key-a' }));
    await claudeProvider.generateQuiz(quizParams, runtime({ apiKey: 'key-b' }));

    // This is the regression that matters: the old module-level memo would have answered the second
    // call with a client still holding key-a.
    expect(ctor).toHaveBeenCalledTimes(2);
    expect(ctor.mock.calls[0][0].authToken).toBe('key-a');
    expect(ctor.mock.calls[1][0].authToken).toBe('key-b');

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('takes the endpoint and model from the runtime config, never from the environment', async () => {
    vi.resetModules();
    const { ctor, create } = mockAnthropicCtor();

    const claudeProvider = await import('../src/providers/claudeProvider.js');
    await claudeProvider.generateQuiz(
      quizParams,
      runtime({ baseUrl: 'https://gateway.example.invalid/ica', model: 'per-user-model' })
    );

    // The endpoint is a constructor option; the model travels on each request.
    expect(ctor.mock.calls[0][0].baseURL).toBe('https://gateway.example.invalid/ica');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'per-user-model' }));
  });

  it('refuses to build a client without credentials, rather than falling back to an ambient key', async () => {
    vi.resetModules();
    mockAnthropicCtor();

    const claudeProvider = await import('../src/providers/claudeProvider.js');
    await expect(claudeProvider.generateQuiz(quizParams, runtime({ apiKey: null }))).rejects.toThrow(
      /requires a resolved AI runtime config/
    );

    vi.doUnmock('@anthropic-ai/sdk');
  });
});
