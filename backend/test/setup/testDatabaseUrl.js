import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PROVIDERS, detectProvider } from '../../src/lib/dbDialect.js';

/**
 * Where the test suite's data lives, for whichever engine DATABASE_URL names.
 *
 * The single choke point: called from both globalSetup.js and setup/env.js, so the two cannot
 * disagree about which database the run is pointed at.
 *
 * Postgres gets a `test` schema inside the same database, so no second database is needed and
 * DATABASE_URL only ever has to be set once (in .env) for both dev and test. SQLite has no schemas,
 * so it gets a separate file instead.
 */

const BACKEND = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

// Prisma resolves a relative `file:` path against the directory of the schema that declares the
// datasource -- not the process cwd. For SQLite that schema is prisma/sqlite/schema.prisma, so
// `file:./test.db` means prisma/sqlite/test.db. Encoded here once so globalSetup deletes the same
// file the client opens.
const SQLITE_SCHEMA_DIR = path.join(BACKEND, 'prisma', 'sqlite');

const TEST_DB_FILENAME = 'test.db';

/** Everything SQLite may leave beside the database, all of which must go with it. */
const SQLITE_SIDECARS = ['', '-journal', '-wal', '-shm'];

/** The part of a `file:` URL after the scheme, without any query string. */
function fileSpec(url) {
  return url.slice(url.indexOf(':') + 1).split('?')[0];
}

export function testDatabaseUrl(baseUrl) {
  const provider = detectProvider(baseUrl);
  if (!provider) {
    throw new Error(
      baseUrl
        ? 'DATABASE_URL does not name a supported database. Use a PostgreSQL URL ("postgresql://...") ' +
            'or a SQLite file path ("file:./dev.db") before running tests.'
        : 'DATABASE_URL is not set -- copy .env.example to .env and fill it in before running tests.'
    );
  }

  if (provider === DB_PROVIDERS.POSTGRESQL) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}schema=test`;
  }

  // The failure this branch exists to prevent: the SQLite connector *silently ignores* an unknown
  // query parameter, so appending `?schema=test` to a file: URL would have run the whole suite --
  // resetDb's deleteMany calls included -- against the developer's own dev.db. Swap the filename
  // instead, keeping whatever directory the operator wrote so the two databases sit side by side.
  // `path.win32` rather than `path`: it treats both "/" and "\" as separators on every platform, so
  // a Windows-style path in DATABASE_URL is handled the same on a POSIX host. Splitting on the last
  // separator by hand would mean a literal backslash in a regex for no gain.
  const spec = fileSpec(baseUrl);
  const filename = path.win32.basename(spec);
  // Keeps the directory prefix verbatim, whichever separator the operator wrote.
  return `file:${spec.slice(0, spec.length - filename.length)}${TEST_DB_FILENAME}`;
}

/**
 * Absolute path of the SQLite test database, resolved against the schema directory exactly as Prisma
 * resolves it. Needed because a runtime `datasources` override resolves a relative `file:` path
 * against the process cwd instead, which would silently point at a different file.
 */
export function sqliteTestDbFile(testUrl) {
  return path.resolve(SQLITE_SCHEMA_DIR, fileSpec(testUrl));
}

/** The test database plus every sidecar SQLite may leave beside it, for globalSetup to delete. */
export function sqliteTestDbPaths(testUrl) {
  const absolute = sqliteTestDbFile(testUrl);
  return SQLITE_SIDECARS.map((suffix) => `${absolute}${suffix}`);
}
