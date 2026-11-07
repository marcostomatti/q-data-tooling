import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

export type DrizzleClient = ReturnType<typeof drizzle>;

/** Where the database lives when `DATABASE_URL` is unset or empty, relative to the working directory. */
export const DEFAULT_DATABASE_PATH = './data/app.db';

/** The name SQLite reads as a private, in-memory database that ends with its connection. */
export const MEMORY_DATABASE = ':memory:';

/** The prefix a `DATABASE_URL` naming a database file carries before the file's path. */
const FILE_PREFIX = 'file:';

/**
 * Thrown when `DATABASE_URL` is set to something other than `file:<path>` or `:memory:`, such
 * as a Postgres URL left over from the other dialect. The message never repeats the value,
 * because a URL can carry a password.
 */
export class InvalidDatabaseUrlError extends Error {
  constructor() {
    super(
      'DATABASE_URL must be `file:<path>` or `:memory:` for SQLite, or be unset to use ' +
        `${DEFAULT_DATABASE_PATH}.`,
    );
    this.name = 'InvalidDatabaseUrlError';
  }
}

type OpenConnection = {
  readonly sqlite: Database
  readonly db: DrizzleClient
};

let connection: OpenConnection | undefined;

/**
 * The path SQLite opens for a `DATABASE_URL`: the default when the value is unset or empty,
 * `:memory:` as itself, and the path after `file:` otherwise.
 *
 * @throws {InvalidDatabaseUrlError} for any other value, and for `file:` with no path after it.
 */
export function databasePath(url: string | undefined): string {
  if (url === undefined || url === '') return DEFAULT_DATABASE_PATH;
  if (url === MEMORY_DATABASE) return MEMORY_DATABASE;
  const path = url.startsWith(FILE_PREFIX)
    ? url.slice(FILE_PREFIX.length)
    : '';
  if (path === '') throw new InvalidDatabaseUrlError();
  return path;
}

/**
 * Opens the SQLite database at `path`. For a file, the folder that holds it is created first
 * when it does not exist, and the journal is switched to WAL, so readers are not blocked by
 * the one writer. `:memory:` gets neither: it has no folder, and SQLite keeps its journal in
 * memory whatever is asked.
 */
export function openDatabase(path: string): Database {
  if (path === MEMORY_DATABASE) return new Database(path);

  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.run('PRAGMA journal_mode = WAL');
  return sqlite;
}

/**
 * Returns the one Drizzle client for this process. `DATABASE_URL` is read when the client is
 * first opened (see {@link databasePath}); later calls reuse the same connection.
 *
 * @throws {InvalidDatabaseUrlError} when `DATABASE_URL` names no SQLite database.
 */
export function getDb(): DrizzleClient {
  if (connection) return connection.db;

  const sqlite = openDatabase(databasePath(process.env.DATABASE_URL));
  connection = { sqlite, db: drizzle({ client: sqlite }) };
  return connection.db;
}

/**
 * Closes the connection, so the next {@link getDb} reads `DATABASE_URL` again. Safe to call
 * twice. Async, like the Postgres client's, so a caller awaits either dialect the same way.
 */
export async function closeDb(): Promise<void> {
  const open = connection;
  connection = undefined;
  open?.sqlite.close();
}
