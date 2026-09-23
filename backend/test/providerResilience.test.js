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

describe('claudeProvider / openaiProvider resilience wiring', () => {
  beforeEach(() => {
    anthropicCtor.mockClear();
    openaiCtor.mockClear();
  });

  it('constructs the Anthropic client with a bounded timeout and explicit maxRetries', async () => {
    const claudeProvider = await import('../src/providers/claudeProvider.js');
    await claudeProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 1 });

    expect(anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: expect.any(Number), maxRetries: expect.any(Number) })
    );
    const opts = anthropicCtor.mock.calls[0][0];
    expect(opts.timeout).toBeLessThan(600_000); // strictly less than the SDK's 10-minute default
    expect(opts.maxRetries).toBeGreaterThanOrEqual(0);
  });

  it('constructs the OpenAI client with a bounded timeout and explicit maxRetries', async () => {
    const openaiProvider = await import('../src/providers/openaiProvider.js');
    await openaiProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 1 });

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
      claudeProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 1 })
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
      claudeProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 20 })
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
      openaiProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 20 })
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
    await openaiProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 1 });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: expect.any(Number) }));

    vi.doUnmock('openai');
  });

  it('reuses one SDK client across calls instead of constructing one per request', async () => {
    vi.resetModules();
    const ctor = vi.fn();
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        constructor(opts) {
          ctor(opts);
          this.messages = {
            create: vi.fn().mockResolvedValue({
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: '{"topic":"t","difficulty":"beginner","questions":[]}' }],
            }),
          };
        }
      },
    }));

    const claudeProvider = await import('../src/providers/claudeProvider.js');
    await claudeProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 1 });
    await claudeProvider.generateQuiz({ topic: 't', difficulty: 'beginner', numQuestions: 1 });

    expect(ctor).toHaveBeenCalledTimes(1);

    vi.doUnmock('@anthropic-ai/sdk');
  });
});
