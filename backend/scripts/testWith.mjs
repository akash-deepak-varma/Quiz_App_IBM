#!/usr/bin/env node
/**
 * Runs the backend suite against one engine:
 *
 *   node scripts/testWith.mjs postgres [vitest args]
 *   node scripts/testWith.mjs sqlite   [vitest args]
 *   node scripts/testWith.mjs auto     [vitest args]   # whichever engine .env points at
 *
 * Both runs execute the same tests; only DATABASE_URL differs, and test/setup/testDatabaseUrl.js
 * derives the throwaway test database from it. What makes them mutually exclusive is the Prisma
 * client: the query engine ships per provider, so the client has to be regenerated for whichever
 * engine is about to be exercised. Hence `test:all` is sequential, not parallel.
 *
 * The URL is passed to the child explicitly. dotenv does not overwrite variables that are already
 * set, so the .env loaded inside the test process leaves it alone.
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PROVIDERS, detectProvider } from '../src/lib/dbDialect.js';

const require = createRequire(import.meta.url);
const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALIASES = {
  postgres: DB_PROVIDERS.POSTGRESQL,
  postgresql: DB_PROVIDERS.POSTGRESQL,
  sqlite: DB_PROVIDERS.SQLITE,
};

const [target, ...vitestArgs] = process.argv.slice(2);
const key = String(target).toLowerCase();
// `auto` is what plain `npm test` uses: run against whatever this install is actually configured
// for, while still going through the regenerate step below.
const provider = key === 'auto' ? detectProvider(process.env.DATABASE_URL) : ALIASES[key];
if (!provider) {
  console.error(
    key === 'auto'
      ? 'DATABASE_URL is not set to a supported database, so `npm test` cannot tell which engine ' +
          'to test. Copy .env.example to .env, or run `npm run test:postgres` / `npm run test:sqlite`.'
      : 'Usage: node scripts/testWith.mjs <postgres|sqlite|auto> [vitest args]'
  );
  process.exit(1);
}

// SQLite needs no server, so its URL can simply be asserted. Postgres needs one that actually
// exists, so it has to come from the environment: POSTGRES_DATABASE_URL, or .env's DATABASE_URL
// when that already points at Postgres.
let databaseUrl;
if (provider === DB_PROVIDERS.SQLITE) {
  databaseUrl = process.env.SQLITE_DATABASE_URL || 'file:./dev.db';
} else {
  databaseUrl = process.env.POSTGRES_DATABASE_URL || process.env.DATABASE_URL;
  if (detectProvider(databaseUrl) !== DB_PROVIDERS.POSTGRESQL) {
    console.error(
      'Cannot run the Postgres suite: no PostgreSQL connection string available.\n' +
        'Set POSTGRES_DATABASE_URL (or point DATABASE_URL at Postgres) and make sure the server is running.'
    );
    process.exit(1);
  }
}

const env = { ...process.env, DATABASE_URL: databaseUrl };
console.log(`\n=== test suite against ${provider} ===`); // never prints the URL: it carries a password

// The regenerate is not optional politeness: the Prisma query engine is provider-specific, so
// running the Postgres suite straight after anything SQLite (a `migrate dev`, the other suite)
// would otherwise execute against the wrong engine and fail in ways that look like app bugs.
for (const step of [
  [resolve(BACKEND, 'scripts/syncSqliteSchema.mjs'), '--check'],
  [resolve(BACKEND, 'scripts/prisma.mjs'), 'generate'],
  [require.resolve('vitest/vitest.mjs'), 'run', ...vitestArgs],
]) {
  const run = spawnSync(process.execPath, step, { stdio: 'inherit', cwd: BACKEND, env });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
