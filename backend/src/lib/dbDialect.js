/**
 * Which SQL dialect we are talking to, and the few places that has to matter.
 *
 * The app supports PostgreSQL and SQLite. Prisma cannot switch provider at runtime -- its schema
 * engine rejects both `provider = env(...)` and a provider array -- so the provider is a property of
 * the *install*, fixed by which schema file was generated against. Everything here exists so that
 * runtime code can ask which one it got without a second env var that could disagree with
 * DATABASE_URL.
 *
 * Deliberately dependency-free (no `env` import): `config/env.js` imports `detectProvider` to build
 * `env.databaseProvider`, so importing env back would be a cycle. Callers pass the provider in.
 */

export const DB_PROVIDERS = {
  POSTGRESQL: 'postgresql',
  SQLITE: 'sqlite',
};

// Keyed by URL scheme, because that is the one part of a connection string that is guaranteed to
// identify the engine. `postgres:` is the common shorthand; `sqlite:` is not a URL form Prisma
// accepts (it wants `file:`) but recognising it turns a confusing Prisma error into our own.
const SCHEME_TO_PROVIDER = new Map([
  ['postgresql', DB_PROVIDERS.POSTGRESQL],
  ['postgres', DB_PROVIDERS.POSTGRESQL],
  ['file', DB_PROVIDERS.SQLITE],
  ['sqlite', DB_PROVIDERS.SQLITE],
]);

/**
 * The provider implied by a connection string, or null when it names no engine we support.
 *
 * Returning null rather than throwing keeps this testable and lets the caller own the wording of
 * the failure -- `config/env.js` is the place that knows to point the reader at .env.example.
 */
export function detectProvider(url) {
  if (typeof url !== 'string') return null;
  const scheme = url.trim().toLowerCase().match(/^([a-z][a-z0-9+.-]*):/);
  return scheme ? (SCHEME_TO_PROVIDER.get(scheme[1]) ?? null) : null;
}

/**
 * A `contains` filter that ignores case on every supported engine.
 *
 * Prisma's `mode: 'insensitive'` is PostgreSQL-only -- the `QueryMode` type is not even present in
 * the SQLite query engine, so passing it there fails validation with `Unknown argument 'mode'`.
 * It is also not needed there: `mode` exists because Postgres `LIKE` is case-sensitive and needs
 * `ILIKE`, whereas SQLite's `LIKE` is already case-insensitive for ASCII by default
 * (`PRAGMA case_sensitive_like` is off). So the two branches mean the same thing for the topic names
 * this filters on, and no lowercased shadow column is required.
 */
export function caseInsensitiveContains(value, provider) {
  return provider === DB_PROVIDERS.POSTGRESQL
    ? { contains: value, mode: 'insensitive' }
    : { contains: value };
}

/** True when the install is on SQLite, whose runtime setup lives in lib/sqlitePragmas.js. */
export function isSqlite(provider) {
  return provider === DB_PROVIDERS.SQLITE;
}
