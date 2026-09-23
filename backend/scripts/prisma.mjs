#!/usr/bin/env node
/**
 * Provider-aware Prisma CLI passthrough: picks the schema that matches DATABASE_URL.
 *
 * Prisma refuses to load a schema whose datasource provider disagrees with the URL ("Error
 * validating datasource `db`: the URL must start with the protocol `file:`"), so for any given
 * DATABASE_URL there is exactly one correct schema and no reason to make the operator remember
 * which. Everything after the script name is forwarded verbatim:
 *
 *   node scripts/prisma.mjs migrate deploy
 *   node scripts/prisma.mjs studio
 *
 * Spawns the CLI via node with its resolved entry point rather than `npx prisma`, so it behaves the
 * same on Windows (where node_modules/.bin/prisma is a .cmd shim) and needs no shell.
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PROVIDERS, detectProvider } from '../src/lib/dbDialect.js';

const require = createRequire(import.meta.url);
const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCHEMAS = {
  [DB_PROVIDERS.POSTGRESQL]: 'prisma/schema.prisma',
  [DB_PROVIDERS.SQLITE]: 'prisma/sqlite/schema.prisma',
};

const provider = detectProvider(process.env.DATABASE_URL);
if (!provider) {
  // Same wording as the boot guard in src/config/env.js, and likewise never echoes the URL back.
  console.error(
    process.env.DATABASE_URL
      ? 'DATABASE_URL does not name a supported database. Use a PostgreSQL URL ("postgresql://...") ' +
          'or a SQLite file path ("file:./dev.db").'
      : 'DATABASE_URL is not set -- copy .env.example to .env and fill it in.'
  );
  process.exit(1);
}

// prisma/sqlite/schema.prisma is generated, so refresh it before Prisma reads it -- otherwise a
// stale copy could be migrated against, which is the one failure this layout has to rule out.
if (provider === DB_PROVIDERS.SQLITE) {
  const sync = spawnSync(process.execPath, [resolve(BACKEND, 'scripts/syncSqliteSchema.mjs')], {
    stdio: 'inherit',
    cwd: BACKEND,
  });
  if (sync.status !== 0) process.exit(sync.status ?? 1);
}

const args = process.argv.slice(2);
// An explicit --schema wins, so this stays usable for one-off invocations against a scratch database.
const forwarded = args.includes('--schema')
  ? args
  : [...args, '--schema', resolve(BACKEND, SCHEMAS[provider])];

console.log(`> prisma ${args.join(' ')}   [provider: ${provider}]`);
const run = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...forwarded], {
  stdio: 'inherit',
  cwd: BACKEND,
});
process.exit(run.status ?? 1);
