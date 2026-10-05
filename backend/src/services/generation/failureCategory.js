import { TruncatedResponseError } from '../../lib/errors.js';

/**
 * The failure taxonomy every batch attempt is recorded under (solution.md section 9.1).
 *
 * The point of naming these is that the *response* to a failure differs by cause. The old
 * generator had one response -- "run the identical prompt again" -- which is correct for a rate
 * limit, useless for a schema violation, and actively wrong for a truncated response.
 */
export const FAILURE_CATEGORIES = {
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_RATE_LIMIT: 'PROVIDER_RATE_LIMIT',
  PROVIDER_4XX: 'PROVIDER_4XX',
  PROVIDER_5XX: 'PROVIDER_5XX',
  NETWORK_ERROR: 'NETWORK_ERROR',
  OUTPUT_TRUNCATED: 'OUTPUT_TRUNCATED',
  PARSE_ERROR: 'PARSE_ERROR',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  CANCELLED: 'CANCELLED',
  // The user's AI configuration is missing, unreadable, or names an endpoint that is not allowed.
  // Distinct from PROVIDER_4XX because the fix is on the AI Settings page, not in the request --
  // which is why the frontend copy for it links there.
  AI_CONFIG_MISSING: 'AI_CONFIG_MISSING',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Categories where the same request is worth sending again: the model either never saw it or
 * never got to answer. Everything else needs a *different* request (smaller batch, corrective
 * feedback) or no retry at all.
 */
const TRANSIENT = new Set([
  FAILURE_CATEGORIES.PROVIDER_TIMEOUT,
  FAILURE_CATEGORIES.PROVIDER_RATE_LIMIT,
  FAILURE_CATEGORIES.PROVIDER_5XX,
  FAILURE_CATEGORIES.NETWORK_ERROR,
]);

export function isTransient(category) {
  return TRANSIENT.has(category);
}

/**
 * A 4xx that is not a rate limit is a request defect; a cancellation is a decision; a missing or
 * unusable AI configuration is a setting only the user can change. Retrying any of them cannot
 * help, so the ladder must not spend its attempt budget on them.
 */
const NON_RETRYABLE = new Set([
  FAILURE_CATEGORIES.PROVIDER_4XX,
  FAILURE_CATEGORIES.CANCELLED,
  FAILURE_CATEGORIES.AI_CONFIG_MISSING,
]);

export function isRetryable(category) {
  return !NON_RETRYABLE.has(category);
}

const TIMEOUT_NAMES = new Set(['APIConnectionTimeoutError', 'AbortError', 'TimeoutError']);
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
]);

/**
 * Map a thrown error onto the taxonomy. Reads the shapes both SDKs actually produce:
 * `err.status` (HTTP status on `APIError`), `err.name` (`APIConnectionTimeoutError`,
 * `APIConnectionError`), `err.code` (Node socket errors), and the message thrown by
 * `extractJsonFromText` when no JSON could be recovered from the response text.
 */
export function classifyError(err) {
  if (!err) return FAILURE_CATEGORIES.UNKNOWN;

  if (err instanceof TruncatedResponseError || err.name === 'TruncatedResponseError') {
    return FAILURE_CATEGORIES.OUTPUT_TRUNCATED;
  }

  // Lets a caller pre-classify (the store does this for cancellation) without re-deriving.
  if (err.failureCategory && FAILURE_CATEGORIES[err.failureCategory]) {
    return err.failureCategory;
  }

  if (TIMEOUT_NAMES.has(err.name)) return FAILURE_CATEGORIES.PROVIDER_TIMEOUT;

  const status = Number(err.status ?? err.statusCode);
  if (Number.isFinite(status) && status > 0) {
    if (status === 408) return FAILURE_CATEGORIES.PROVIDER_TIMEOUT;
    if (status === 429) return FAILURE_CATEGORIES.PROVIDER_RATE_LIMIT;
    if (status >= 500) return FAILURE_CATEGORIES.PROVIDER_5XX;
    if (status >= 400) return FAILURE_CATEGORIES.PROVIDER_4XX;
  }

  if (NETWORK_CODES.has(err.code) || err.name === 'APIConnectionError') {
    return FAILURE_CATEGORIES.NETWORK_ERROR;
  }

  const message = String(err.message ?? '');
  if (/timed?\s*out/i.test(message)) return FAILURE_CATEGORIES.PROVIDER_TIMEOUT;
  // Thrown by providers/promptUtils.js#extractJsonFromText once all three recovery stages fail.
  if (/JSON/i.test(message)) return FAILURE_CATEGORIES.PARSE_ERROR;

  return FAILURE_CATEGORIES.UNKNOWN;
}
