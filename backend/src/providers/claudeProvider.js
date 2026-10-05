import Anthropic from '@anthropic-ai/sdk';
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

/**
 * One client per resolved runtime config object -- not one per process, and not one per call.
 *
 * This used to be a single module-level `let client`, memoized from env on first use. That was a
 * sound optimization when there was one key for the whole server and a fatal bug once each user
 * brings their own: the first caller's credentials would have served every later caller.
 *
 * Keyed on the config *object* rather than on a string built from its fields, for two reasons. A
 * string key would have to include the API key, making the cache a permanent in-memory map of
 * plaintext credentials. And a WeakMap entry disappears when the config object does -- which is
 * when the request or job that resolved it finishes -- so a rotated key is never served from a
 * stale cache and nothing is retained between requests.
 *
 * The original optimization is preserved where it mattered: one generation job resolves exactly one
 * config object and holds it in the closures getProvider built, so a 20-question quiz still
 * constructs one client and reuses it across all of its batches.
 */
const clients = new WeakMap();

function getClient(runtime) {
  if (!runtime?.apiKey) {
    // Unreachable via getProvider -- aiConfigService refuses to build a keyless runtime for a real
    // provider. This guards a future direct caller, so it is not a user-facing message.
    throw new Error('claudeProvider requires a resolved AI runtime config with an apiKey');
  }

  let client = clients.get(runtime);
  if (!client) {
    client = new Anthropic({
      // undefined rather than null, so the SDK applies its own default when the user saved none.
      baseURL: runtime.baseUrl ?? undefined,

      // Your ICA-compatible gateway expects:
      // Authorization: Bearer <token>
      authToken: runtime.apiKey,

      // milliseconds
      timeout: runtime.timeoutMs,

      // SDK already retries transient/network failures.
      maxRetries: runtime.maxRetries,

      // Re-validates every outgoing URL and refuses redirects. The SDK would otherwise follow a
      // 302 from a validated host to an internal address -- see validation/aiEndpoint.js.
      fetch: runtime.fetch,
    });
    clients.set(runtime, client);
  }
  return client;
}

async function complete(system, user, runtime) {
  const startedAt = Date.now();

  try {
    console.log('[AI] Starting Claude request', {
      model: runtime.model,
      timeoutMs: runtime.timeoutMs,
      maxRetries: runtime.maxRetries,
      promptLength: user.length,
    });

    const response = await getClient(runtime).messages.create({
      model: runtime.model,
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

export async function generateQuiz(params, runtime) {
  const { system, user } = buildQuizGenerationPrompt(params);
  const { text, usage } = await complete(system, user, runtime);

  // `usage` rides along for per-batch token telemetry; the quiz itself is rebuilt field by field
  // downstream, so it never reaches a persisted question.
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

/**
 * Cheapest possible proof that this endpoint, key and model actually work together.
 *
 * Deliberately the same API call generation uses, capped at a handful of tokens, rather than
 * something like GET /v1/models: the ICA gateway's model-listing support is unverified, and a 404
 * there would look to the user exactly like a bad key. The response text is thrown away --
 * extractJsonFromText is never run on it, so a chatty model cannot make a working connection look
 * broken.
 */
export async function ping(_params, runtime) {
  const startedAt = Date.now();

  const response = await getClient(runtime).messages.create({
    model: runtime.model,
    max_tokens: 4,
    messages: [{ role: 'user', content: 'ping' }],
  });

  return {
    model: runtime.model,
    latencyMs: Date.now() - startedAt,
    stopReason: response.stop_reason ?? null,
  };
}
