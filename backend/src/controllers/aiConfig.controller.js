import { prisma } from '../lib/prismaClient.js';
import { env } from '../config/env.js';
import { AI_PROVIDERS } from '../constants/enums.js';
import { AI_PROVIDER_DEFAULTS } from '../constants/aiDefaults.js';
import { encryptApiKey } from '../lib/apiKeyCrypto.js';
import { BadRequestError } from '../lib/errors.js';
import { getProvider } from '../providers/index.js';
import { resolveAiConfig, toPublicAiConfig } from '../services/aiConfigService.js';
import { classifyError, FAILURE_CATEGORIES } from '../services/generation/failureCategory.js';
import { assertSafeAiUrl } from '../validation/aiEndpoint.js';
import { parseAiConfigSave, parseAiConfigTest } from '../validation/aiConfigRequest.js';

/**
 * Per-user AI provider configuration.
 *
 * The contract of this whole file is that the API key goes in and never comes back out. GET returns
 * `hasApiKey`, a boolean derived from whether the ciphertext column is populated -- the plaintext is
 * never decrypted on this path at all, so there is nothing to accidentally serialize.
 */

const TEST_TIMEOUT_MS = 15_000;
const MAX_TEST_DETAIL_LENGTH = 200;

/** Shape shared by every response here, so the frontend has one thing to parse. */
function configResponse(row) {
  return {
    ...toPublicAiConfig(row),
    // Sent so the frontend stops duplicating constants/enums.js AI_PROVIDERS, and so the form can
    // show a useful endpoint placeholder even in production where ANTHROPIC_BASE_URL is unset.
    providers: AI_PROVIDERS,
    defaults: AI_PROVIDER_DEFAULTS,
    // Lets the settings page explain *why* generation works without a key on a dev machine.
    envFallbackEnabled: env.aiAllowEnvFallback,
  };
}

export async function get(req, res, next) {
  try {
    const row = await prisma.userAiConfig.findUnique({ where: { userId: req.user.id } });
    // Never a 404: "I have not configured anything" is a valid state of this resource, and a 404
    // would make the frontend's load-then-save page branch for no reason.
    res.json(configResponse(row));
  } catch (err) {
    next(err);
  }
}

export async function put(req, res, next) {
  try {
    const { provider, baseUrl, model, apiKey } = parseAiConfigSave(req.body);

    // The async half of endpoint validation. Structural checks already ran in the validator; this
    // is the DNS resolution, which is what catches a hostname pointing at a private address.
    if (baseUrl) await assertSafeAiUrl(baseUrl);

    const shared = { provider, baseUrl, model };

    // `undefined` means "keep whatever is stored", so the column is simply omitted from the write.
    // `null` means "clear it". Both are distinguishable here only because the validator preserved
    // the difference -- see parseAiConfigSave.
    const keyFields =
      apiKey === undefined
        ? {}
        : apiKey === null
          ? { apiKeyCipher: null }
          : { apiKeyCipher: encryptApiKey(apiKey, req.user.id), keyVersion: 1 };

    const row = await prisma.userAiConfig.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, ...shared, ...keyFields },
      update: {
        ...shared,
        ...keyFields,
        // A changed provider/endpoint/model invalidates whatever the last test proved.
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestDetail: null,
      },
    });

    res.json(configResponse(row));
  } catch (err) {
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    // deleteMany rather than delete, so "I had nothing saved" is not a 404. Deleting the row
    // outright -- rather than nulling the cipher -- is what a "forget my AI setup" button should do.
    await prisma.userAiConfig.deleteMany({ where: { userId: req.user.id } });
    res.json(configResponse(null));
  } catch (err) {
    next(err);
  }
}

/**
 * Fixed copy per failure shape. Never `err.message` verbatim: an SDK error message can echo request
 * context, and the point of this endpoint is to tell the user which of their four fields is wrong.
 */
function describeTestFailure(err, category) {
  const status = Number(err?.status ?? err?.statusCode);

  if (category === FAILURE_CATEGORIES.AI_CONFIG_MISSING) {
    // Our own validation rejected it -- that message is already written for a user.
    return err.message;
  }
  if (status === 401 || status === 403) {
    return `The provider rejected this key (HTTP ${status}). Check the key, and that the endpoint matches the gateway the key was issued for.`;
  }
  if (status === 404) {
    return 'The endpoint answered but has no such path (HTTP 404). Check the base URL -- for ICA, Claude ends in /ica and OpenAI in /ica/v1.';
  }
  if (status === 400 || status === 422) {
    return `The provider rejected the request (HTTP ${status}). The model name is the usual cause.`;
  }

  switch (category) {
    case FAILURE_CATEGORIES.PROVIDER_RATE_LIMIT:
      return 'The provider is rate limiting (HTTP 429). Wait a minute and try again.';
    case FAILURE_CATEGORIES.PROVIDER_5XX:
      return `The provider had a server error${Number.isFinite(status) ? ` (HTTP ${status})` : ''}. That is not your key -- try again shortly.`;
    case FAILURE_CATEGORIES.PROVIDER_TIMEOUT:
      return `No reply within ${TEST_TIMEOUT_MS / 1000} seconds. Check the base URL.`;
    case FAILURE_CATEGORIES.NETWORK_ERROR:
      return 'Could not reach that host. Check the base URL.';
    default:
      return 'The call failed for an unrecognised reason. Check the base URL, key and model.';
  }
}

export async function test(req, res, next) {
  const startedAt = Date.now();

  try {
    const submitted = parseAiConfigTest(req.body);
    const row = await prisma.userAiConfig.findUnique({ where: { userId: req.user.id } });

    const provider = submitted.provider ?? row?.provider ?? 'mock';
    const usedSavedKey = submitted.apiKey === null;

    if (provider !== 'mock' && usedSavedKey && !row?.apiKeyCipher) {
      throw new BadRequestError('Enter an API key to test, or save one first.');
    }

    const resolved = await resolveAiConfig({
      userId: req.user.id,
      requestedProvider: provider,
      overrides: submitted.apiKey
        ? {
            apiKey: submitted.apiKey,
            baseUrl: submitted.baseUrl ?? row?.baseUrl ?? null,
            model: submitted.model ?? row?.model ?? null,
            // A connection test has to come back while the user is still looking at the page, and
            // must not retry a wrong key three times before admitting it is wrong.
            timeoutMs: Math.min(env.aiProviderTimeoutMs, TEST_TIMEOUT_MS),
            maxRetries: 0,
          }
        : { timeoutMs: Math.min(env.aiProviderTimeoutMs, TEST_TIMEOUT_MS), maxRetries: 0 },
    });

    const client = getProvider(resolved.provider, resolved.runtime);
    if (typeof client.ping !== 'function') {
      throw new BadRequestError(`The "${resolved.provider}" provider does not support connection testing`);
    }

    let outcome;
    try {
      const pinged = await client.ping({});
      outcome = {
        ok: true,
        provider: resolved.provider,
        model: pinged.model,
        latencyMs: pinged.latencyMs ?? Date.now() - startedAt,
        usedSavedKey,
        detail: pinged.detail ?? `Connected. The provider answered in ${pinged.latencyMs} ms.`,
      };
    } catch (err) {
      const category = classifyError(err);
      // One line for diagnosis. `message` here is the SDK's, which does not contain the key -- the
      // key only ever travels in a header, and nothing logs headers.
      console.error('[AI] test connection failed', {
        userId: req.user.id,
        provider: resolved.provider,
        status: err?.status,
        name: err?.name,
        message: err?.message,
      });
      outcome = {
        ok: false,
        provider: resolved.provider,
        model: resolved.runtime?.model ?? null,
        latencyMs: Date.now() - startedAt,
        usedSavedKey,
        failureCategory: category,
        status: Number.isFinite(Number(err?.status)) ? Number(err.status) : null,
        detail: describeTestFailure(err, category),
      };
    }

    // Only recorded when the test used the *saved* key: testing unsaved form values must not
    // rewrite the row, or a failed experiment would mark a working saved config as broken.
    if (usedSavedKey && row) {
      await prisma.userAiConfig.update({
        where: { userId: req.user.id },
        data: {
          lastTestedAt: new Date(),
          lastTestStatus: outcome.ok ? 'OK' : 'FAILED',
          lastTestDetail: outcome.detail.slice(0, MAX_TEST_DETAIL_LENGTH),
        },
      });
    }

    // 200 even when ok:false. The HTTP status describes *this* endpoint, and this endpoint worked:
    // it asked the provider and got an answer. A 5xx would also be destroyed by
    // middleware/errorHandler.js, which masks every 5xx message to "Something went wrong. Please
    // try again." -- discarding the one piece of information the user actually needed.
    //
    // A genuine bad request to *us* (unknown provider, no key to test, rejected endpoint) still
    // throws and still becomes a real 400 via next(err).
    res.json(outcome);
  } catch (err) {
    next(err);
  }
}
