import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/globalSetup.js'],
    setupFiles: ['./test/setup/env.js'],
    // Multiple test files would otherwise write to the same shared SQLite test.db concurrently.
    fileParallelism: false,
  },
});
