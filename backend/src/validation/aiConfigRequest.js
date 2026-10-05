import { BadRequestError } from '../lib/errors.js';
import { AI_PROVIDERS } from '../constants/enums.js';
import { validateAiBaseUrl } from './aiEndpoint.js';

/**
 * Body validation for the AI configuration endpoints, in the style of validation/generateRequest.js
 * -- plain imperative checks that throw BadRequestError on the first problem, no schema library.
 *
 * Structural only. The DNS-based endpoint checks are async and live in validation/aiEndpoint.js;
 * the controller runs them after this.
 */

const MAX_MODEL_LENGTH = 200;
const MAX_KEY_LENGTH = 4096;

/** Printable ASCII only. See the comment in assertSendableApiKey for why this is enforced. */
const NON_PRINTABLE_ASCII = /[^\x20-\x7E]/;

function trimmedOrNull(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestError(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The API key becomes an `Authorization` header value.
 *
 * A newline in a header value is header injection, and a non-ASCII byte makes undici throw an
 * opaque TypeError from deep inside the SDK -- which would reach the user as "Something went
 * wrong". Both are worth catching here, where the message can name the actual problem.
 *
 * This is genuinely new risk surface: `env.anthropic.apiKey` came from a trusted .env file written
 * by whoever deployed the server. A user-pasted key does not, and pasting a key out of a PDF or a
 * chat window picks up stray whitespace and smart quotes routinely.
 */
function assertSendableApiKey(apiKey) {
  if (apiKey.length > MAX_KEY_LENGTH) {
    throw new BadRequestError(`The API key is too long (max ${MAX_KEY_LENGTH} characters)`);
  }
  if (NON_PRINTABLE_ASCII.test(apiKey)) {
    throw new BadRequestError(
      'The API key contains characters that cannot be sent in a request header. Paste it again without line breaks.'
    );
  }
}

function parseProvider(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError('provider is required');
  }
  const provider = value.trim();
  if (!AI_PROVIDERS.includes(provider)) {
    throw new BadRequestError(`provider must be one of: ${AI_PROVIDERS.join(', ')}`);
  }
  return provider;
}

function parseModel(value) {
  const model = trimmedOrNull(value, 'model');
  if (model === null) return null;
  if (model.length > MAX_MODEL_LENGTH) {
    throw new BadRequestError(`model must be at most ${MAX_MODEL_LENGTH} characters`);
  }
  if (NON_PRINTABLE_ASCII.test(model)) {
    throw new BadRequestError('model contains characters that are not allowed');
  }
  return model;
}

/**
 * PUT /api/me/ai-config
 *
 * The three-way `apiKey` rule, which exists because GET never returns the key and so the client is
 * structurally incapable of sending back what it was never given:
 *
 *   absent/undefined -> keep the stored key   (`apiKey: undefined` in the result)
 *   ""               -> clear the stored key  (`apiKey: null`)
 *   non-empty string -> replace it            (`apiKey: '<the key>'`)
 */
export function parseAiConfigSave(body) {
  const raw = body || {};
  const provider = parseProvider(raw.provider);

  let apiKey;
  if (raw.apiKey === undefined || raw.apiKey === null) {
    apiKey = undefined; // keep
  } else if (typeof raw.apiKey !== 'string') {
    throw new BadRequestError('apiKey must be a string');
  } else if (raw.apiKey.trim() === '') {
    apiKey = null; // clear
  } else {
    apiKey = raw.apiKey.trim();
    assertSendableApiKey(apiKey);
  }

  if (provider === 'mock') {
    // The mock provider makes no network call, so an endpoint or model for it is meaningless and
    // accepting one would quietly imply it does something.
    if (trimmedOrNull(raw.baseUrl, 'baseUrl') || parseModel(raw.model)) {
      throw new BadRequestError('The mock provider does not take an endpoint or model');
    }
    // A stored key is deliberately KEPT when switching to mock, so flipping to mock and back does
    // not cost a re-paste. `hasApiKey` stays true, and the saved provider governs resolution.
    return { provider, baseUrl: null, model: null, apiKey };
  }

  const baseUrl = trimmedOrNull(raw.baseUrl, 'baseUrl');
  // Structural check here for a precise message; the controller follows with the DNS check.
  if (baseUrl) validateAiBaseUrl(baseUrl);

  return { provider, baseUrl, model: parseModel(raw.model), apiKey };
}

/**
 * POST /api/me/ai-config/test
 *
 * Every field is optional and falls back to the stored row, which is what lets one endpoint serve
 * both required modes: testing unsaved form values, and re-testing an already-saved key.
 */
export function parseAiConfigTest(body) {
  const raw = body || {};

  const provider = raw.provider === undefined || raw.provider === null ? null : parseProvider(raw.provider);

  let apiKey = null;
  if (typeof raw.apiKey === 'string' && raw.apiKey.trim() !== '') {
    apiKey = raw.apiKey.trim();
    assertSendableApiKey(apiKey);
  }

  const baseUrl = trimmedOrNull(raw.baseUrl, 'baseUrl');
  if (baseUrl) validateAiBaseUrl(baseUrl);

  return { provider, baseUrl, model: parseModel(raw.model), apiKey };
}
