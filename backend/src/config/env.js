import 'dotenv/config';
import { detectProvider } from '../lib/dbDialect.js';

export const env = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET,

  // Which SQL dialect this install talks to, derived from DATABASE_URL's scheme rather than a
  // second env var -- a DB_PROVIDER that could contradict the URL is a failure mode worth not
  // inventing. Prisma reads DATABASE_URL itself; only the provider is exposed here, because the
  // URL carries a password and this object ends up in debug output.
  databaseProvider: detectProvider(process.env.DATABASE_URL),
  aiProvider: process.env.AI_PROVIDER || 'mock',
  quizGenerateRateLimit: Number(process.env.QUIZ_GENERATE_RATE_LIMIT) || 10,
  explainRateLimit: Number(process.env.EXPLAIN_RATE_LIMIT) || 30,
  // Both SDKs default to a 10-minute timeout with no explicit bound -- long enough for a
  // stalled ICA gateway call to look indistinguishable from a hang. maxRetries relies on
  // each SDK's own built-in backoff (network errors/408/409/429/5xx only, never a 4xx
  // validation-style response), so no hand-rolled retry logic is needed here.
  aiProviderTimeoutMs: Number(process.env.AI_PROVIDER_TIMEOUT_MS) || 60000,
  aiProviderMaxRetries: Number(process.env.AI_PROVIDER_MAX_RETRIES) || 2,

  // A quiz is generated as several independent batches. Concurrency 3 keeps a 20-question quiz to
  // a few waves without inviting provider rate limits; attempts are per batch, not per quiz, so
  // 3 buys real recovery instead of the old "same prompt twice, then give up".
  aiGenerationConcurrency: Number(process.env.AI_GENERATION_CONCURRENCY) || 3,
  aiGenerationMaxBatchAttempts: Number(process.env.AI_GENERATION_MAX_BATCH_ATTEMPTS) || 3,
  // Per-batch `[GEN]` lines are the point in production and pure noise in a test run, where a
  // single deliberate-failure case can emit a dozen of them. Test setup sets this to 'off'.
  generationLogEnabled: process.env.GENERATION_LOG !== 'off',

  // The in-process worker that drains queued generation jobs. Started from server.js only -- the
  // test suites import app.js directly and must never begin polling the database. Setting this to
  // false to run a separate worker process is a PostgreSQL-only arrangement: the claim is safe on
  // either engine, but SQLite permits one writer at a time, so a second process would wait rather
  // than add throughput.
  generationWorkerEnabled: process.env.GENERATION_WORKER_ENABLED !== 'false',
  generationWorkerPollMs: Number(process.env.GENERATION_WORKER_POLL_MS) || 1000,
  // How stale a claim must be before another worker may take the job over. Long enough that a
  // slow provider call is never mistaken for a dead worker.
  generationLeaseMs: Number(process.env.GENERATION_LEASE_MS) || 120000,

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

// Fail at boot rather than on the first query. Previously nothing here read DATABASE_URL at all,
// so a missing or malformed one surfaced as a Prisma error from whichever request happened to
// touch the database first.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set -- copy .env.example to .env and fill it in.');
}
if (!env.databaseProvider) {
  // Deliberately does not echo the URL back: it contains the database password.
  throw new Error(
    'DATABASE_URL does not name a supported database. Use a PostgreSQL URL ("postgresql://...") ' +
      'or a SQLite file path ("file:./dev.db").'
  );
}
