import 'dotenv/config';
import { detectProvider } from '../lib/dbDialect.js';
import { assertEncryptionKeyConfigured } from '../lib/apiKeyCrypto.js';

export const env = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET,

  // Which SQL dialect this install talks to, derived from DATABASE_URL's scheme rather than a
  // second env var -- a DB_PROVIDER that could contradict the URL is a failure mode worth not
  // inventing. Prisma reads DATABASE_URL itself; only the provider is exposed here, because the
  // URL carries a password and this object ends up in debug output.
  databaseProvider: detectProvider(process.env.DATABASE_URL),
  aiProvider: process.env.AI_PROVIDER || 'mock',

  // Per-user AI credentials are the only source in production. This fallback exists so that local
  // development (and backend/test/setup/test.js, the hand-run ICA probe) keep working against the
  // ANTHROPIC_*/OPENAI_* vars when no user has saved a config. It must stay false in production:
  // it is what guarantees two users can never spend the same key.
  aiAllowEnvFallback: process.env.AI_ALLOW_ENV_FALLBACK === 'true',

  // Allows http:// and loopback AI endpoints, for a locally hosted model (Ollama, LM Studio).
  // Deliberately separate from aiAllowEnvFallback: conflating two security switches means flipping
  // one for convenience silently disarms the other. The boot guard below refuses to start with this
  // true in production, because it is the one flag that disables the scheme and loopback checks in
  // validation/aiEndpoint.js.
  aiAllowInsecureEndpoints: process.env.AI_ALLOW_INSECURE_ENDPOINTS === 'true',

  // Test Connection makes a real outbound call to a URL the caller chose, so it gets its own small
  // budget rather than sharing quiz generation's.
  aiConfigTestRateLimit: Number(process.env.AI_CONFIG_TEST_RATE_LIMIT) || 10,

  // Signup/login attempts per IP per 15 minutes. Generous for real use, and low enough that
  // bcrypt-bound brute force is not worth attempting.
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 20,

  // Render (and any reverse proxy) sets X-Forwarded-For. Without trust proxy, req.ip is the proxy's
  // address -- so middleware/rateLimit.js's `req.user?.id || req.ip` fallback lumps every
  // unauthenticated caller into one bucket, and express-rate-limit v7 logs
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request. Off by default so the test suite is
  // unaffected.
  trustProxy: process.env.TRUST_PROXY === '1',

  // Shared code required to create an account, so a public prototype URL does not accept signups
  // from everyone who finds it.
  signupInviteCode: process.env.SIGNUP_INVITE_CODE,

  // Kept env-driven rather than hardcoded in authService.js so a deployment can shorten it without
  // a code change. 7d is the long-standing default and stays the default.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // Browser origins allowed to call this API. Exact scheme, no trailing slash -- an entry like
  // "https://x.onrender.com/" never matches an Origin header.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
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

// Fails at boot rather than when the first user tries to save an API key -- a missing or
// wrong-length key is otherwise invisible until exactly the wrong moment.
assertEncryptionKeyConfigured();

if (!env.signupInviteCode) {
  throw new Error('SIGNUP_INVITE_CODE is not set -- copy .env.example to .env and fill it in.');
}

// NODE_ENV was previously read nowhere in this codebase. It is introduced here for exactly one
// purpose: refusing to start with a development-only escape hatch left on in production. Both of
// these flags are safe locally and unsafe on a shared deployment, which is a distinction only the
// environment can make.
if (process.env.NODE_ENV === 'production') {
  if (env.aiAllowInsecureEndpoints) {
    throw new Error(
      'AI_ALLOW_INSECURE_ENDPOINTS must not be true in production -- it disables the https and ' +
        'loopback checks that stop a user-supplied endpoint reaching internal addresses.'
    );
  }
  if (env.aiAllowEnvFallback) {
    // A warning rather than a throw: it is a sharing/privacy problem, not a hole an attacker walks
    // through, and someone running a single-user private instance may genuinely want it.
    console.warn(
      '[WARN] AI_ALLOW_ENV_FALLBACK is true in production: every user without a saved AI config ' +
        'will spend this server\'s own API keys. Set it to false unless that is intended.'
    );
  }
  if (env.corsOrigins.length === 1 && env.corsOrigins[0] === 'http://localhost:5173') {
    console.warn('[WARN] CORS_ORIGINS is unset, so only http://localhost:5173 is allowed. Set it to your frontend URL.');
  }
}
