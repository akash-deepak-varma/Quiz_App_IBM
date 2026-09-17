import OpenAI from 'openai';
import { env } from '../config/env.js';
import {
  extractJsonFromText,
  buildQuizGenerationPrompt,
  buildGradeShortAnswerPrompt,
  buildGradeCodePrompt,
  buildExplainMistakePrompt,
} from './promptUtils.js';

function getClient() {
  return new OpenAI({
    baseURL: env.openai.baseURL,
    apiKey: env.openai.apiKey,
    timeout: env.aiProviderTimeoutMs,
    maxRetries: env.aiProviderMaxRetries,
  });
}

async function complete(system, user) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: env.openai.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI response contained no message content');
  }
  return text;
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
