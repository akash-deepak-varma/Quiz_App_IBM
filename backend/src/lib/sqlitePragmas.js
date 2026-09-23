/**
 * SQLite runtime setup: the one PRAGMA this app sets, and why the obvious others are left alone.
 *
 * A no-op on PostgreSQL, so callers do not have to branch.
 *
 * **journal_mode = WAL** is the setting that matters, though not for the reason usually given: in the
 * default `delete` mode a reader is locked out while a write transaction *commits*, not for the whole
 * transaction. That window is still worth removing. Measured on this schema, a multi-megabyte commit
 * stalled concurrent reads for ~210 ms -- 80% of that transaction's wall clock -- which in this app
 * means every dashboard and library request queueing behind one generation job materialising its
 * quiz. The same probe under WAL never exceeded 4 ms. The price is roughly 15% slower uncontended
 * writes, which is the right trade for an interactive app. Only writer-vs-writer still serialises,
 * and that is inherent to SQLite.
 *
 * The setting lives in the database file header rather than the connection, so executing it once at
 * boot sticks -- across restarts, and for any other process opening the same file. The exception is a
 * network filesystem, where WAL's shared-memory file cannot work; SQLite then refuses and stays in
 * `delete` mode, which is why the result below is checked rather than assumed.
 *
 * **busy_timeout is deliberately NOT set here.** Prisma's SQLite connector already applies one to
 * every connection it opens -- measured at 5000 ms by default -- and derives it from the URL's
 * `socket_timeout` parameter, so `file:./dev.db?socket_timeout=20` yields a 20 s timeout. A PRAGMA
 * issued here would be redundant, and worse, it would only ever apply to whichever pooled connection
 * happened to run it. The knob already exists; it belongs in DATABASE_URL, not in this file.
 *
 * **connection_limit=1 is deliberately NOT forced either.** The usual argument for pinning SQLite to
 * a single connection is to make per-connection PRAGMA state deterministic -- which is moot, given
 * the above. It is not free: one connection puts reads in the same queue as writes, reintroducing
 * exactly the stall WAL exists to remove. So the pool is left at Prisma's default and WAL does the
 * work. An operator who wants writes strictly serialised can still add `connection_limit=1` to
 * DATABASE_URL.
 */

import { isSqlite } from './dbDialect.js';

/**
 * Puts a SQLite database into WAL mode. Returns the resulting journal mode, or null on PostgreSQL.
 *
 * Failure is reported, not thrown: a database that will not take WAL still works correctly, just
 * with writers blocking readers, and refusing to boot over that would be the wrong trade.
 */
export async function applySqlitePragmas(client, provider) {
  if (!isSqlite(provider)) return null;

  // `PRAGMA journal_mode = <mode>` answers with the mode actually in force, which is how a refusal
  // is detected -- SQLite reports the old mode rather than raising.
  const rows = await client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  const journalMode = rows?.[0]?.journal_mode ?? null;

  if (journalMode !== 'wal') {
    console.warn(
      `[db] SQLite stayed in "${journalMode}" journal mode instead of WAL. Reads will block while a ` +
        'write is in progress. This normally means the database file is on a network filesystem.'
    );
  }

  return journalMode;
}
