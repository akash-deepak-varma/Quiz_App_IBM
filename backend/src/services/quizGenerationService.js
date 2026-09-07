import { getProvider } from '../providers/index.js';
import { validateQuizSchema } from '../validation/quizSchema.js';
import { QuizGenerationFailedError } from '../lib/errors.js';

const MAX_ATTEMPTS = 2;

export async function generateValidatedQuiz(params) {
  const provider = getProvider(params.provider);
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await provider.generateQuiz(params);
      const { valid, errors } = validateQuizSchema(raw);
      if (valid) {
        return { quiz: raw, providerUsed: provider.name };
      }
      lastError = errors;
    } catch (err) {
      lastError = err;
    }
  }

  throw new QuizGenerationFailedError(lastError);
}
