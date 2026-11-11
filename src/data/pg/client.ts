import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type DrizzleClient = ReturnType<typeof drizzle>;

type OpenConnection = {
  readonly sql: postgres.Sql
  readonly db: DrizzleClient
};

/**
 * Thrown when the Postgres client is opened with `DATABASE_URL` unset or empty. Postgres has no
 * default database to fall back on, unlike SQLite's `./data/app.db`.
 */
export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      'DATABASE_URL is not set. Set it in .env (the Postgres line in .env.example), or export it, ' +
        'before opening the database.',
    );
    this.name = 'MissingDatabaseUrlError';
  }
}

let connection: OpenConnection | undefined;

/**
 * Returns the one Drizzle client for this process. `DATABASE_URL` is read when the client is
 * first opened; later calls reuse the same connection pool. The pool connects lazily, so this
 * returns without reaching the server: the first query is what fails on a database that is down.
 *
 * @throws {MissingDatabaseUrlError} when `DATABASE_URL` is unset or empty.
 */
export function getDb(): DrizzleClient {
  if (connection) return connection.db;

  const url = process.env.DATABASE_URL;
  if (!url) throw new MissingDatabaseUrlError();

  const sql = postgres(url);
  connection = { sql, db: drizzle(sql) };
  return connection.db;
}

/** Closes the pool, so the next {@link getDb} reads `DATABASE_URL` again. Safe to call twice. */
export async function closeDb(): Promise<void> {
  const open = connection;
  connection = undefined;
  if (open) await open.sql.end();
}
