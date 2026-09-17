import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/globalSetup.js'],
    setupFiles: ['./test/setup/env.js'],
    // All test files share the same Postgres "test" schema and truncate the same tables
    // between runs (see test/setup -- resetDb), so they can't run concurrently.
    fileParallelism: false,
  },
});
