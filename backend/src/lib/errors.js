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
      'Quiz generation failed -- the AI provider returned invalid output twice in a row. Please try again.',
      502
    );
    this.cause = cause;
  }
}
