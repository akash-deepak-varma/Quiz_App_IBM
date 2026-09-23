import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/globalSetup.js'],
    setupFiles: ['./test/setup/env.js'],
    // Test files share one database -- a "test" schema on Postgres, a separate test.db file on
    // SQLite -- and clear the same tables between runs (test/setup/resetDb.js), so they cannot run
    // concurrently. It is also what SQLite wants regardless: one writer at a time.
    fileParallelism: false,
  },
});
