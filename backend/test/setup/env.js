// Runs before config/env.js's `import 'dotenv/config'` resolves anywhere else in the module
// graph (Vitest guarantees setupFiles run before a test file's own imports). Loading dotenv
// here first lets us read the real DATABASE_URL from .env and layer `?schema=test` onto it --
// isolating test data into its own Postgres schema inside the same database, no second
// database needed. dotenv does NOT overwrite already-set process.env keys, so setting
// AI_PROVIDER/JWT_SECRET here means the real .env file's values are skipped for those two.
import 'dotenv/config';
import { testDatabaseUrl } from './testDatabaseUrl.js';

process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL);
process.env.AI_PROVIDER = 'mock';
// Generation emits one structured log line per batch attempt; several suites deliberately drive
// batches to failure, which would bury the actual test output.
process.env.GENERATION_LOG = 'off';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-do-not-use-in-prod';
