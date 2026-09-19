import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET,
  aiProvider: process.env.AI_PROVIDER || 'mock',
  quizGenerateRateLimit: Number(process.env.QUIZ_GENERATE_RATE_LIMIT) || 10,
  explainRateLimit: Number(process.env.EXPLAIN_RATE_LIMIT) || 30,
  // Both SDKs default to a 10-minute timeout with no explicit bound -- long enough for a
  // stalled ICA gateway call to look indistinguishable from a hang. maxRetries relies on
  // each SDK's own built-in backoff (network errors/408/409/429/5xx only, never a 4xx
  // validation-style response), so no hand-rolled retry logic is needed here.
  aiProviderTimeoutMs: Number(process.env.AI_PROVIDER_TIMEOUT_MS) || 40000,
  aiProviderMaxRetries: Number(process.env.AI_PROVIDER_MAX_RETRIES) || 2,

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseURL: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL || 'gpt-5.6-terra-dzus',
  },
};

if (!env.jwtSecret) {
  throw new Error('JWT_SECRET is not set -- copy .env.example to .env and fill it in.');
}
