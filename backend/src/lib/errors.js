export class HttpError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

export class BadRequestError extends HttpError {
  constructor(message) {
    super(message, 400);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

// The three AI-configuration errors below each carry `failureCategory`, which
// services/generation/failureCategory.js#classifyError reads as a pre-classification hook (it
// validates the string against its own map before deriving a category from the error shape).
//
// The string is a literal rather than an import on purpose: failureCategory.js already imports
// TruncatedResponseError from this file, so importing FAILURE_CATEGORIES back would be a cycle. A
// typo therefore degrades silently to UNKNOWN -- which is exactly why a test pins these literals.
//
// They are all 400s rather than 500s: nothing is broken on the server, the user has to change a
// setting. And they are all one category, because the remedy is the same page in every case.
const AI_CONFIG_MISSING = 'AI_CONFIG_MISSING';

/**
 * A user-configured AI endpoint failed validation (bad scheme, private/metadata address, redirect).
 */
export class UnsafeEndpointError extends BadRequestError {
  constructor(message = 'API endpoint is not allowed') {
    super(message);
    this.failureCategory = AI_CONFIG_MISSING;
  }
}

/** The user has saved no usable credentials for the provider they are trying to use. */
export class MissingAiConfigError extends BadRequestError {
  constructor(provider) {
    super(
      `No API key is saved for "${provider}". Open AI Settings to add one, or generate with the mock provider instead.`
    );
    this.failureCategory = AI_CONFIG_MISSING;
  }
}

/**
 * The stored ciphertext could not be decrypted -- a rotated ENCRYPTION_KEY, a tampered row, or a
 * row copied between users. Deliberately actionable: the only fix is to paste the key again, so the
 * message says that rather than "something went wrong".
 */
export class AiConfigUnreadableError extends BadRequestError {
  constructor() {
    super('Your saved AI key could not be read. Please re-enter it in AI Settings.');
    this.failureCategory = AI_CONFIG_MISSING;
  }
}

export class UnsupportedProviderError extends BadRequestError {
  constructor(name) {
    super(`Unsupported AI provider: "${name}"`);
  }
}

export class QuizGenerationFailedError extends HttpError {
  constructor(cause) {
    super(
      'Quiz generation failed -- the AI provider could not produce enough valid questions. Please try again.',
      502
    );
    this.cause = cause;
  }
}

// Thrown by a real provider when the model stopped because it hit the output-token cap
// (Claude `stop_reason: "max_tokens"` / OpenAI `finish_reason: "length"`) rather than because
// it finished. Without this, a truncated response surfaces only as unparseable JSON -- which
// is indistinguishable from a formatting failure, and the retry that follows truncates again.
// The generation retry ladder splits the batch on this instead of retrying it identically.
export class TruncatedResponseError extends Error {
  constructor(message = 'Provider response was truncated at the output-token limit') {
    super(message);
    this.name = 'TruncatedResponseError';
  }
}
