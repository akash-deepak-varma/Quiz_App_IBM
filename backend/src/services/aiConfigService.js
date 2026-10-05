import { prisma } from '../lib/prismaClient.js';
import { env } from '../config/env.js';
import { AI_PROVIDERS } from '../constants/enums.js';
import { defaultModelFor } from '../constants/aiDefaults.js';
import { decryptApiKey, hasStoredApiKey } from '../lib/apiKeyCrypto.js';
import { assertSafeAiUrl, createGuardedFetch } from '../validation/aiEndpoint.js';
import {
  AiConfigUnreadableError,
  MissingAiConfigError,
  UnsupportedProviderError,
} from '../lib/errors.js';

/**
 * Where a provider call gets its credentials.
 *
 * One function answers "which provider, with what key, for this user", and every getProvider call
 * site in the app goes through it. The resolution order is fixed and deliberately boring:
 *
 *   1. the user's own UserAiConfig row, decrypted                      -> source: 'user'
 *   2. the server's ANTHROPIC_* and OPENAI_* env vars, but only when
 *      AI_ALLOW_ENV_FALLBACK=true (default false, local development)   -> source: 'env'
 *   3. no credentials needed at all, when the provider is 'mock'       -> runtime: null
 *   4. otherwise, a 400 telling the user to open AI Settings
 *
 * Step 2 is the whole difference between a laptop and a shared deployment. With it off -- the
 * production setting -- it is *impossible* for two users to spend the same key, because there is no
 * key in the system that is not attached to a user.
 */

// Built once: it closes over nothing per-request, and it is the same guard for every provider.
const guardedFetch = createGuardedFetch();

/**
 * @typedef {object} AiRuntimeConfig
 * @property {string} provider
 * @property {string} apiKey
 * @property {string|null} baseUrl
 * @property {string|null} model
 * @property {number} timeoutMs
 * @property {number} maxRetries
 * @property {Function} fetch
 * @property {'user'|'env'} source
 */

function buildRuntime({ provider, apiKey, baseUrl, model, source, timeoutMs, maxRetries }) {
  const runtime = {
    provider,
    apiKey,
    baseUrl: baseUrl || null,
    model: model || defaultModelFor(provider),
    timeoutMs: timeoutMs ?? env.aiProviderTimeoutMs,
    maxRetries: maxRetries ?? env.aiProviderMaxRetries,
    fetch: guardedFetch,
    source,
  };

  // middleware/errorHandler.js does `console.error(err)` on every 5xx, and an SDK error can carry a
  // surprising amount of request context with it. These two make an accidental log, inspect or
  // JSON.stringify of a runtime config print a description instead of a key. Non-enumerable, so the
  // object's own shape -- and therefore every consumer -- is unchanged.
  Object.defineProperty(runtime, 'toJSON', {
    value: () => ({ ...runtime, apiKey: runtime.apiKey ? '[redacted]' : null, fetch: undefined }),
  });
  Object.defineProperty(runtime, Symbol.for('nodejs.util.inspect.custom'), {
    value: () =>
      `AiRuntimeConfig(${provider}/${runtime.model}, source=${source}, key=${runtime.apiKey ? 'set' : 'none'})`,
  });

  // Freezing is compatible with WeakMap keying. A *new object per resolution* is the load-bearing
  // property: it is what makes the providers' WeakMap "one client per resolved config" rather than
  // "one client forever", which is the bug this whole change exists to remove.
  return Object.freeze(runtime);
}

/**
 * Resolve the provider and credentials to use for one request or one job.
 *
 * @param {{ userId?: string, requestedProvider?: string|null, overrides?: object }} args
 * @returns {Promise<{ provider: string, runtime: AiRuntimeConfig|null }>}
 */
export async function resolveAiConfig({ userId, requestedProvider = null, overrides = null }) {
  // mock short-circuits before any database access. That is why the entire mock path -- every
  // fixture call in providers.test.js, scoring.test.js's getProvider('mock'), and a brand-new user
  // who has saved nothing -- needs neither a row nor even a userId.
  if (requestedProvider === 'mock') {
    return { provider: 'mock', runtime: null };
  }

  const row = userId ? await prisma.userAiConfig.findUnique({ where: { userId } }) : null;
  const provider = requestedProvider ?? row?.provider ?? env.aiProvider ?? 'mock';

  if (provider === 'mock') {
    return { provider: 'mock', runtime: null };
  }
  if (!AI_PROVIDERS.includes(provider)) {
    throw new UnsupportedProviderError(provider);
  }

  // Unsaved form values, used only by POST /api/me/ai-config/test. Allows a user to verify a key
  // before committing it, and never touches the database.
  if (overrides?.apiKey) {
    // A blank endpoint is legitimate -- it means "use the SDK's own default" -- so only a supplied
    // one is validated. Same rule as the saved-row branch below.
    if (overrides.baseUrl) await assertSafeAiUrl(overrides.baseUrl);
    return {
      provider,
      runtime: buildRuntime({
        provider,
        apiKey: overrides.apiKey,
        baseUrl: overrides.baseUrl,
        model: overrides.model,
        source: 'user',
        timeoutMs: overrides.timeoutMs,
        maxRetries: overrides.maxRetries,
      }),
    };
  }

  // (1) The user's own row -- but only when it holds credentials for *this* provider. A row saved
  // for openai must not have its key handed to a claude request.
  if (row && row.provider === provider && hasStoredApiKey(row.apiKeyCipher)) {
    let apiKey;
    try {
      apiKey = decryptApiKey(row.apiKeyCipher, userId);
    } catch {
      // ApiKeyDecryptionError is a plain Error with no statusCode, so errorHandler would mask it as
      // "Something went wrong" -- the least useful message for someone whose only fix is to paste
      // their key again. Logs the user and key version, never the ciphertext or the key.
      console.error('[AI] stored key could not be decrypted', {
        userId,
        keyVersion: row.keyVersion,
      });
      throw new AiConfigUnreadableError();
    }

    if (row.baseUrl) await assertSafeAiUrl(row.baseUrl);

    return {
      provider,
      runtime: buildRuntime({
        provider,
        apiKey,
        baseUrl: row.baseUrl,
        model: row.model,
        source: 'user',
        timeoutMs: overrides?.timeoutMs,
        maxRetries: overrides?.maxRetries,
      }),
    };
  }

  // (2) Env fallback. Local development only -- see the boot warning in config/env.js.
  if (env.aiAllowEnvFallback) {
    const fromEnv = provider === 'claude' ? env.anthropic : env.openai;
    if (fromEnv.apiKey) {
      if (fromEnv.baseURL) await assertSafeAiUrl(fromEnv.baseURL);
      return {
        provider,
        runtime: buildRuntime({
          provider,
          apiKey: fromEnv.apiKey,
          baseUrl: fromEnv.baseURL,
          model: fromEnv.model,
          source: 'env',
          timeoutMs: overrides?.timeoutMs,
          maxRetries: overrides?.maxRetries,
        }),
      };
    }
  }

  // (4)
  throw new MissingAiConfigError(provider);
}

/**
 * Which provider should grade or explain an answer on a quiz generated by `providerUsed`.
 *
 * 'mock' stays mock, because a mock-generated quiz has fixture answers: grading them with a real
 * model would make a retake's score depend on which gateway the learner happened to have configured
 * that week, and mockProvider.gradeCode answers false by construction.
 *
 * For a real provider the stored name is honoured, but the credentials come from the user's current
 * configuration -- the key that generated the quiz may have been rotated, revoked or replaced since,
 * and there is nothing else available to use.
 */
export function gradingProviderFor(providerUsed) {
  return providerUsed === 'mock' ? 'mock' : providerUsed;
}

/**
 * The public shape of a user's AI configuration. Never includes the key, by construction rather
 * than by remembering to strip it: the ciphertext is reduced to a boolean here and the plaintext
 * never enters this function at all.
 */
export function toPublicAiConfig(row) {
  return {
    provider: row?.provider ?? 'mock',
    baseUrl: row?.baseUrl ?? null,
    model: row?.model ?? null,
    hasApiKey: hasStoredApiKey(row?.apiKeyCipher),
    lastTestedAt: row?.lastTestedAt ?? null,
    lastTestStatus: row?.lastTestStatus ?? null,
    lastTestDetail: row?.lastTestDetail ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}
