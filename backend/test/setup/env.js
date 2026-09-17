// Runs before env.js's `import 'dotenv/config'` resolves anywhere in the module graph
// (Vitest guarantees setupFiles run before a test file's own imports). dotenv does NOT
// overwrite already-set process.env keys, so setting these here first means the real
// .env file's values are simply skipped for these three keys during tests.
process.env.DATABASE_URL = 'file:./test.db';
process.env.AI_PROVIDER = 'mock';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-do-not-use-in-prod';
