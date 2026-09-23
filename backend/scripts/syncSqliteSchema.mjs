#!/usr/bin/env node
/**
 * Generates prisma/sqlite/schema.prisma from the canonical prisma/schema.prisma.
 *
 * Why a generator and not a second hand-maintained file: Prisma's schema engine rejects both
 * `provider = env(...)` ("The provider argument in a datasource must be a string literal") and the
 * old provider-array form, so one schema file can only ever name one engine. But every *model* in
 * this schema is already dialect-neutral -- no enums, no `Json`, no scalar lists, no `@db.*` native
 * types, no `dbgenerated`, all PKs are `cuid()` text and all JSON payloads are `String` columns
 * round-tripped through lib/serialization.js. So the two schemas differ by exactly one block, and
 * hand-maintaining a copy would buy nothing but drift.
 *
 *   node scripts/syncSqliteSchema.mjs           # write the SQLite schema
 *   node scripts/syncSqliteSchema.mjs --check   # exit 1 if it is stale (wired into `npm test`)
 *
 * The two providers keep separate migration lineages, because SQLite cannot replay the Postgres
 * ones: `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY` is not expressible there (SQLite's ALTER TABLE
 * does RENAME/ADD COLUMN/DROP COLUMN and nothing else), and the Postgres lineage uses it 19 times.
 * Prisma resolves `migrations/` relative to the schema file, so putting this one in prisma/sqlite/
 * is all the separation that is needed.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = resolve(BACKEND, 'prisma/schema.prisma');
const GENERATED = resolve(BACKEND, 'prisma/sqlite/schema.prisma');

const HEADER = `// GENERATED FILE -- DO NOT EDIT.
//
// Produced from prisma/schema.prisma by scripts/syncSqliteSchema.mjs. Edit the canonical schema and
// re-run that script; \`--check\` fails the test run if this file is stale. Only the datasource block
// differs from the canonical schema -- every model below is byte-identical.
`;

const SQLITE_DATASOURCE = `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL") // a file: path, e.g. file:./dev.db -- see lib/dbDialect.js
}`;

// Matched rather than string-replaced so a reformatted or re-commented datasource block still works.
// `[^}]*` is safe here because a datasource body cannot itself contain a brace.
const DATASOURCE_BLOCK = /datasource\s+\w+\s*\{[^}]*\}/;

/** LF-normalised, so a CRLF checkout does not read as drift. */
const normalize = (text) => text.replace(/\r\n/g, '\n');

function build() {
  const canonical = normalize(readFileSync(CANONICAL, 'utf8'));

  if (!DATASOURCE_BLOCK.test(canonical)) {
    throw new Error(`No datasource block found in ${CANONICAL} -- cannot generate the SQLite schema.`);
  }
  const swapped = canonical.replace(DATASOURCE_BLOCK, SQLITE_DATASOURCE);

  if (/provider\s*=\s*"postgresql"/.test(swapped)) {
    // Would mean a second postgres-specific provider somewhere (e.g. a shadow database block).
    throw new Error('A "postgresql" provider survived the swap -- check prisma/schema.prisma by hand.');
  }
  return `${HEADER}\n${swapped}`;
}

const expected = build();
const checkOnly = process.argv.includes('--check');

let actual = null;
try {
  actual = normalize(readFileSync(GENERATED, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

if (normalize(expected) === actual) {
  console.log(`prisma/sqlite/schema.prisma is up to date.`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    actual === null
      ? 'prisma/sqlite/schema.prisma is missing. Run: npm run db:sync-sqlite'
      : 'prisma/sqlite/schema.prisma is stale -- prisma/schema.prisma has changed since it was generated.\n' +
        'Run: npm run db:sync-sqlite   (and `prisma migrate dev` against the SQLite lineage if models changed)'
  );
  process.exit(1);
}

// Written with LF regardless of the canonical file's endings: it is machine-generated, and a stable
// convention keeps `--check` and git diffs quiet.
mkdirSync(dirname(GENERATED), { recursive: true });
writeFileSync(GENERATED, normalize(expected), 'utf8');
console.log(`Wrote prisma/sqlite/schema.prisma from prisma/schema.prisma.`);
