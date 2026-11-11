import type { Db } from '../repositories/db.ts';

/**
 * Runs `body` in one transaction on Postgres: every write it makes commits when it resolves, and
 * none does when it rejects. A call made inside a running body (on `tx`) is a savepoint.
 *
 * drizzle's postgres-js driver awaits the callback, so this is its own `transaction`. It exists
 * so code calls one function on both dialects: on SQLite, drizzle's `transaction` commits an
 * async callback at its first `await` (see the SQLite `transact`).
 */
export function transact<R>(db: Db, body: (tx: Db) => Promise<R>): Promise<R> {
  return db.transaction((tx) => body(tx));
}
