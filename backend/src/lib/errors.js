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
