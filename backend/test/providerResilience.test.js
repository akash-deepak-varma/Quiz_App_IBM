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
});
