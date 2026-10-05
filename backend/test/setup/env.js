// Runs before config/env.js's `import 'dotenv/config'` resolves anywhere else in the module
// graph (Vitest guarantees setupFiles run before a test file's own imports). Loading dotenv
// here first lets us read the real DATABASE_URL from .env and point it at the test database --
// a `test` schema inside the same Postgres database, or a separate file on SQLite, so neither
// engine needs a second DATABASE_URL. dotenv does NOT overwrite already-set process.env keys,
// so setting AI_PROVIDER/JWT_SECRET here means the real .env file's values are skipped for those two.
import 'dotenv/config';
import { testDatabaseUrl } from './testDatabaseUrl.js';

process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL);
process.env.AI_PROVIDER = 'mock';
// Generation emits one structured log line per batch attempt; several suites deliberately drive
// batches to failure, which would bury the actual test output.
process.env.GENERATION_LOG = 'off';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-do-not-use-in-prod';
// Both are forced rather than defaulted with `||`, like AI_PROVIDER and GENERATION_LOG above and
// unlike JWT_SECRET. dotenv has already run by this point, so a `||` would hand the developer's own
// .env value to the suite -- and test/setup/signup.js hardcodes the invite code it sends, so a
// local SIGNUP_INVITE_CODE would 403 every signup in every integration suite.
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 'test-only-encryption-key').toString('base64');
// Keep in step with TEST_INVITE_CODE in test/setup/signup.js.
process.env.SIGNUP_INVITE_CODE = 'test-invite-code';
// Per-user config is the only credential source under test, same as production. A suite that wants
// the env fallback sets this itself.
process.env.AI_ALLOW_ENV_FALLBACK = 'false';

// The IP-keyed auth limiter is a single in-memory store shared by the whole run (fileParallelism is
// off, so every suite is one process), and every supertest request arrives from the same loopback
// address. At the production default of 20 per 15 minutes, the run exhausts the budget partway
// through and later suites start getting 429s from signup -- which surfaces as unrelated
// assertion failures, not as an obvious rate-limit error. Raised here rather than lowered in
// production; a dedicated test can override it back down if the limiter itself needs covering.
process.env.AUTH_RATE_LIMIT = '100000';
