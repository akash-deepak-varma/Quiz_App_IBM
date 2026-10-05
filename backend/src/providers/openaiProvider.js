import OpenAI from 'openai';
import { TruncatedResponseError } from '../lib/errors.js';
import {
  extractJsonFromText,
  buildQuizGenerationPrompt,
  buildGradeShortAnswerPrompt,
  buildGradeCodePrompt,
  buildExplainMistakePrompt,
} from './promptUtils.js';

// This provider previously sent no output-token cap at all, so the server's default decided where
// a quiz got cut off -- and a cut-off response only ever showed up as invalid JSON. Matching the
// Claude provider's explicit limit makes truncation both bounded and detectable.
const MAX_TOKENS = 8192;

export const capabilities = {
  // The sampled gateway model is unlikely to honour `response_format: json_object`, and the ICA
  // gateway's support for it is unverified -- same reasoning as claudeProvider.js.
  structuredOutput: false,
  promptCaching: false,
  streaming: false,
  maxOutputTokens: MAX_TOKENS,
};

// One client per resolved runtime config object. See the long comment in claudeProvider.js for why
// this is a WeakMap keyed on the object rather than a process-wide memo or a credential-keyed Map.
const clients = new WeakMap();

function getClient(runtime) {
  if (!runtime?.apiKey) {
    throw new Error('openaiProvider requires a resolved AI runtime config with an apiKey');
  }

  let client = clients.get(runtime);
  if (!client) {
    client = new OpenAI({
      baseURL: runtime.baseUrl ?? undefined,
      apiKey: runtime.apiKey,
      timeout: runtime.timeoutMs,
      maxRetries: runtime.maxRetries,
      // Re-validates every outgoing URL and refuses redirects -- see validation/aiEndpoint.js.
      fetch: runtime.fetch,
    });
    clients.set(runtime, client);
  }
  return client;
}

async function complete(system, user, runtime) {
  const startedAt = Date.now();

  try {
    console.log('[AI] Starting OpenAI request', {
      model: runtime.model,
      timeoutMs: runtime.timeoutMs,
      maxRetries: runtime.maxRetries,
      promptLength: user.length,
    });

    const response = await getClient(runtime).chat.completions.create({
      model: runtime.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const choice = response.choices?.[0];
    const usage = {
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
    };

    console.log('[AI] OpenAI request completed', {
      durationMs: Date.now() - startedAt,
      finishReason: choice?.finish_reason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    if (choice?.finish_reason === 'length') {
      throw new TruncatedResponseError(
        `OpenAI stopped at the ${MAX_TOKENS}-token output limit; the response is incomplete`
      );
    }

    const text = choice?.message?.content;
    if (!text) {
      throw new Error('OpenAI response contained no message content');
    }

    return { text, usage };
  } catch (error) {
    // Previously this provider had no logging and no error handling at all, so a failed OpenAI
    // call left nothing behind to diagnose -- the asymmetry noted in architecture.md section 10.
    console.error('[AI] OpenAI request failed', {
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

export async function generateQuiz(params, runtime) {
  const { system, user } = buildQuizGenerationPrompt(params);
  const { text, usage } = await complete(system, user, runtime);

  return { ...extractJsonFromText(text), usage };
}

export async function gradeShortAnswer(params, runtime) {
  const { system, user } = buildGradeShortAnswerPrompt(params);
  const { text } = await complete(system, user, runtime);

  return extractJsonFromText(text);
}

export async function gradeCode(params, runtime) {
  const { system, user } = buildGradeCodePrompt(params);
  const { text } = await complete(system, user, runtime);

  return extractJsonFromText(text);
}

export async function explainMistake(params, runtime) {
  const { system, user } = buildExplainMistakePrompt(params);
  const { text } = await complete(system, user, runtime);

  return extractJsonFromText(text);
}

/** See claudeProvider.ping -- same contract, same reasoning for using a tiny completion. */
export async function ping(_params, runtime) {
  const startedAt = Date.now();

  const response = await getClient(runtime).chat.completions.create({
    model: runtime.model,
    max_tokens: 4,
    messages: [{ role: 'user', content: 'ping' }],
  });

  return {
    model: runtime.model,
    latencyMs: Date.now() - startedAt,
    stopReason: response.choices?.[0]?.finish_reason ?? null,
  };
}
