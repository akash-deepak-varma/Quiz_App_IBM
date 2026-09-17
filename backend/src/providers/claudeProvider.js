import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import {
  extractJsonFromText,
  buildQuizGenerationPrompt,
  buildGradeShortAnswerPrompt,
  buildGradeCodePrompt,
  buildExplainMistakePrompt,
} from './promptUtils.js';

// Richer explanations plus up to MAX_QUESTIONS (20) questions can exceed a smaller cap and
// truncate the JSON response, so this is sized generously rather than tightly.
const MAX_TOKENS = 8192;

function getClient() {
  // ICA's gateway expects Bearer-token auth -- `authToken` sends `Authorization: Bearer <key>`,
  // unlike the SDK's default `apiKey` option which signs requests differently.
  return new Anthropic({
    baseURL: env.anthropic.baseURL,
    authToken: env.anthropic.apiKey,
    timeout: env.aiProviderTimeoutMs,
    maxRetries: env.aiProviderMaxRetries,
  });
}

async function complete(system, user) {
  const client = getClient();
  const response = await client.messages.create({
    model: env.anthropic.model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('Claude response contained no text content');
  }
  return textBlock.text;
}

export async function generateQuiz(params) {
  const { system, user } = buildQuizGenerationPrompt(params);
  return extractJsonFromText(await complete(system, user));
}

export async function gradeShortAnswer(params) {
  const { system, user } = buildGradeShortAnswerPrompt(params);
  return extractJsonFromText(await complete(system, user));
}

export async function gradeCode(params) {
  const { system, user } = buildGradeCodePrompt(params);
  return extractJsonFromText(await complete(system, user));
}

export async function explainMistake(params) {
  const { system, user } = buildExplainMistakePrompt(params);
  return extractJsonFromText(await complete(system, user));
}
