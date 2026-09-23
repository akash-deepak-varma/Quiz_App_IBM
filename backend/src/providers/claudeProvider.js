import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { TruncatedResponseError } from '../lib/errors.js';
import {
  extractJsonFromText,
  buildQuizGenerationPrompt,
  buildGradeShortAnswerPrompt,
  buildGradeCodePrompt,
  buildExplainMistakePrompt,
} from './promptUtils.js';

const MAX_TOKENS = 8192;

/**
 * Declared capabilities, for the generation layer to consult rather than hardcode per provider.
 * `structuredOutput` stays false deliberately: whether the ICA gateway passes Claude tool-use
 * through is unverified, so prompt-instructed strict JSON plus `extractJsonFromText` remains the
 * portable path (see promptUtils.js).
 */
export const capabilities = {
  structuredOutput: false,
  promptCaching: false,
  streaming: false,
  maxOutputTokens: MAX_TOKENS,
};

// Memoized: generation now issues several calls per quiz, and each `new Anthropic()` re-parses
// config and builds a fresh connection pool for no reason. Lazy so that merely registering this
// provider in providers/index.js still costs nothing when AI_PROVIDER is not 'claude'.
let client;

function getClient() {
  if (!client) {
    client = new Anthropic({
      baseURL: env.anthropic.baseURL,

      // Your ICA-compatible gateway expects:
      // Authorization: Bearer <token>
      authToken: env.anthropic.apiKey,

      // milliseconds
      timeout: env.aiProviderTimeoutMs,

      // SDK already retries transient/network failures.
      maxRetries: env.aiProviderMaxRetries,
    });
  }
  return client;
}

async function complete(system, user) {
  const startedAt = Date.now();

  try {
    console.log('[AI] Starting Claude request', {
      model: env.anthropic.model,
      timeoutMs: env.aiProviderTimeoutMs,
      maxRetries: env.aiProviderMaxRetries,
      promptLength: user.length,
    });

    const response = await getClient().messages.create({
      model: env.anthropic.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [
        {
          role: 'user',
          content: user,
        },
      ],
    });

    const usage = {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    };

    console.log('[AI] Claude request completed', {
      durationMs: Date.now() - startedAt,
      stopReason: response.stop_reason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    // The response was cut off mid-JSON, not finished. Previously this surfaced only as
    // unparseable text, indistinguishable from a formatting mistake -- so the retry asked for the
    // same oversized batch and truncated again. Naming it lets the retry ladder split instead.
    if (response.stop_reason === 'max_tokens') {
      throw new TruncatedResponseError(
        `Claude stopped at the ${MAX_TOKENS}-token output limit; the response is incomplete`
      );
    }

    const textBlock = response.content.find((block) => block.type === 'text');

    if (!textBlock) {
      throw new Error('Claude response contained no text content');
    }

    return { text: textBlock.text, usage };
  } catch (error) {
    console.error('[AI] Claude request failed', {
      durationMs: Date.now() - startedAt,
      name: error?.name,
      message: error?.message,
      status: error?.status,
      requestId: error?.request_id,
      cause: error?.cause?.message,
    });

    throw error;
  }
}

export async function generateQuiz(params) {
  const { system, user } = buildQuizGenerationPrompt(params);
  const { text, usage } = await complete(system, user);

  // `usage` rides along for per-batch token telemetry; the quiz itself is rebuilt field by field
  // downstream, so it never reaches a persisted question.
  return { ...extractJsonFromText(text), usage };
}

export async function gradeShortAnswer(params) {
  const { system, user } = buildGradeShortAnswerPrompt(params);
  const { text } = await complete(system, user);

  return extractJsonFromText(text);
}

export async function gradeCode(params) {
  const { system, user } = buildGradeCodePrompt(params);
  const { text } = await complete(system, user);

  return extractJsonFromText(text);
}

export async function explainMistake(params) {
  const { system, user } = buildExplainMistakePrompt(params);
  const { text } = await complete(system, user);

  return extractJsonFromText(text);
}
