import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import {
  extractJsonFromText,
  buildQuizGenerationPrompt,
  buildGradeShortAnswerPrompt,
  buildGradeCodePrompt,
  buildExplainMistakePrompt,
} from './promptUtils.js';

const MAX_TOKENS = 8192;

function getClient() {
  return new Anthropic({
    baseURL: env.anthropic.baseURL,

    // Your ICA-compatible gateway expects:
    // Authorization: Bearer <token>
    authToken: env.anthropic.apiKey,

    // milliseconds
    timeout: env.aiProviderTimeoutMs ?? 180_000,

    // SDK already retries transient/network failures.
    maxRetries: env.aiProviderMaxRetries ?? 1,
  });
}

async function complete(system, user) {
  const client = getClient();

  const startedAt = Date.now();

  try {
    console.log('[AI] Starting Claude request', {
      model: env.anthropic.model,
      timeoutMs: env.aiProviderTimeoutMs,
      maxRetries: env.aiProviderMaxRetries,
      promptLength: user.length,
    });

    const response = await client.messages.create({
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

    // console.log("\n========== RAW CLAUDE RESPONSE ==========");
    // console.log(JSON.stringify(response, null, 2));
    // console.log("=========================================\n");

    console.log('[AI] Claude request completed', {
      durationMs: Date.now() - startedAt,
      stopReason: response.stop_reason,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    const textBlock = response.content.find(
      (block) => block.type === 'text'
    );

    if (!textBlock) {
      throw new Error('Claude response contained no text content');
    }


    return textBlock.text;
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

  const text = await complete(system, user);

  return extractJsonFromText(text);
}

export async function gradeShortAnswer(params) {
  const { system, user } = buildGradeShortAnswerPrompt(params);

  return extractJsonFromText(
    await complete(system, user)
  );
}

export async function gradeCode(params) {
  const { system, user } = buildGradeCodePrompt(params);

  return extractJsonFromText(
    await complete(system, user)
  );
}

export async function explainMistake(params) {
  const { system, user } = buildExplainMistakePrompt(params);

  return extractJsonFromText(
    await complete(system, user)
  );
}