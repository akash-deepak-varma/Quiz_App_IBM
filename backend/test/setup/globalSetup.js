import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { DB_PROVIDERS, detectProvider } from '../../src/lib/dbDialect.js';
import { applySqlitePragmas } from '../../src/lib/sqlitePragmas.js';
import { sqliteTestDbFile, sqliteTestDbPaths, testDatabaseUrl } from './testDatabaseUrl.js';

const backendRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Provider-aware, so it picks the schema (and therefore the migration lineage) matching the URL. */
function prisma(args, env, input) {
  execFileSync(process.execPath, [path.join(backendRoot, 'scripts/prisma.mjs'), ...args], {
    cwd: backendRoot,
    env,
    ...(input === undefined ? { stdio: 'inherit' } : { input, stdio: ['pipe', 'inherit', 'inherit'] }),
  });
}

export default async function setup() {
  const databaseUrl = testDatabaseUrl(process.env.DATABASE_URL);
  const provider = detectProvider(databaseUrl);
  const env = { ...process.env, DATABASE_URL: databaseUrl };

  // Start from nothing, so a run can never inherit rows from the last one. Postgres drops the
  // namespace; SQLite has no namespaces, so the file goes instead -- which is what this project did
  // before it moved to Postgres.
  if (provider === DB_PROVIDERS.POSTGRESQL) {
    prisma(['db', 'execute', '--stdin'], env, 'DROP SCHEMA IF EXISTS "test" CASCADE;');
  } else {
    // `force` so a first run, with no database yet, is not an error.
    for (const file of sqliteTestDbPaths(databaseUrl)) rmSync(file, { force: true });
  }

  prisma(['migrate', 'deploy'], env);

  // Same call the server makes at boot, so the suite runs under the journal mode production uses
  // rather than a second-best default. journal_mode lives in the database file header, so setting it
  // here once carries into every test file's own connection. The URL is rebuilt from the absolute
  // path because a `datasources` override resolves a relative `file:` path against the cwd, not the
  // schema directory.
  if (provider === DB_PROVIDERS.SQLITE) {
    const client = new PrismaClient({
      datasources: { db: { url: `file:${sqliteTestDbFile(databaseUrl)}` } },
    });
    try {
      const journalMode = await applySqlitePragmas(client, provider);
      console.log(`> sqlite journal_mode: ${journalMode}`);
    } finally {
      await client.$disconnect();
    }
  }
}
