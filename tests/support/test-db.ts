/**
 * The integration tests' database: a scratch Postgres database for one test file, created on the
 * server `DATABASE_URL` names, with every migration in `drizzle/pg/` applied, and dropped when the
 * file closes it.
 *
 * `bun test` loads `.env.test` over `.env`, and `.env.test` points `DATABASE_URL` at the Docker
 * server `bun run db:up` starts. Only that URL's server and credentials are read: the database it
 * names is never opened, so no test writes to the dev database. `CREATE DATABASE` and
 * `DROP DATABASE` run on {@link SERVER_DATABASE}, which every Postgres server has.
 *
 * A file opens one database in `beforeAll`, empties it with {@link TestDatabase.reset} before each
 * test, and closes it in `afterAll`, so a file pays for one create and one migration run.
 *
 * @module
 */

import type { ActiveClient } from '../../src/data/active.ts';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { migratePg } from '../../src/data/migrate.ts';

/** The database every Postgres server has, where the scratch databases are created and dropped. */
export const SERVER_DATABASE = 'postgres';

/** The prefix of every scratch database's name, so a leftover one is easy to tell apart. */
export const SCRATCH_PREFIX = 'scratch_';

/** Thrown when `DATABASE_URL` is unset, which happens only when `.env.test` was not loaded. */
export class MissingTestDatabaseUrlError extends Error {
  /** Builds the error with the fix in its message. */
  constructor() {
    super('DATABASE_URL is not set: run the integration tests with `bun run test:integration`, which loads .env.test');
    this.name = 'MissingTestDatabaseUrlError';
  }
}

/**
 * The server URL the scratch databases are made on: `DATABASE_URL`, read from `env`.
 *
 * @param env - Where `DATABASE_URL` is read. Defaults to `process.env`.
 * @returns The URL as it is set.
 * @throws {MissingTestDatabaseUrlError} when `DATABASE_URL` is unset or empty.
 */
export function serverUrlOf(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (url === undefined || url === '') throw new MissingTestDatabaseUrlError();
  return url;
}

/**
 * `serverUrl`'s server and credentials, pointed at the database `name`.
 *
 * @param serverUrl - A Postgres URL; its own database is replaced.
 * @param name - The database to name.
 * @returns The new URL.
 */
export function databaseUrlFor(serverUrl: string, name: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** A scratch database open for one test file. */
export interface TestDatabase {
  /** The scratch database's name, {@link SCRATCH_PREFIX} and a random suffix. */
  readonly name: string
  /** Its URL, for code that reads `DATABASE_URL`, such as the service a test starts. */
  readonly url: string
  /** The drizzle client the repositories and flows are handed. */
  readonly db: ActiveClient
  /**
   * The raw `postgres` handle, for checks written in SQL so they do not lean on the code under
   * test. It is the same client {@link TestDatabase.db} runs on, and drizzle's postgres-js
   * driver sets that client to pass timestamps through as text: a `timestamptz` comes back as a
   * string, and a `Date` parameter is refused. Read a time as `extract(epoch from ...)` or as
   * text, and pass one as an ISO string or through `to_timestamp(...)`.
   */
  readonly sql: postgres.Sql
  /** Empties every table the migrations made and restarts their sequences; the migrations stay applied. */
  reset(): Promise<void>
  /** Ends the connection and drops the database. Safe to call twice. */
  close(): Promise<void>
}

/** Options that quiet the client: a notice such as "table does not exist, skipping" is not a test's concern. */
const QUIET = { max: 1, onnotice: () => {} } as const;

/** Runs `statement` on the server's own database, over a connection opened for it alone. */
async function onServer(serverUrl: string, statement: string): Promise<void> {
  const admin = postgres(databaseUrlFor(serverUrl, SERVER_DATABASE), QUIET);
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end();
  }
}

/** The tables in the `public` schema, quoted for a statement; the migrations' own table is elsewhere. */
async function publicTables(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`select tablename as name from pg_tables where schemaname = 'public' order by tablename`;
  return rows.map((row) => `"${row.name}"`);
}

/**
 * Creates a scratch database on the `DATABASE_URL` server and applies every Postgres migration to
 * it. Call it in `beforeAll` and close the result in `afterAll`.
 *
 * @param env - Where `DATABASE_URL` is read. Defaults to `process.env`.
 * @returns The open database.
 * @throws {MissingTestDatabaseUrlError} when `DATABASE_URL` is unset.
 * @throws When the server does not answer, as when Docker is not running: start it with
 *   `bun run db:up`.
 */
export async function openTestDatabase(env: NodeJS.ProcessEnv = process.env): Promise<TestDatabase> {
  const serverUrl = serverUrlOf(env);
  const name = `${SCRATCH_PREFIX}${crypto.randomUUID().replaceAll('-', '')}`;
  const url = databaseUrlFor(serverUrl, name);
  await onServer(serverUrl, `CREATE DATABASE "${name}"`);

  const sql = postgres(url, QUIET);
  const db = drizzle(sql) as unknown as ActiveClient;
  let tables: string[] = [];
  try {
    await migratePg(db);
    tables = await publicTables(sql);
  } catch (error: unknown) {
    try {
      await sql.end();
    } finally {
      await onServer(serverUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    throw error;
  }

  let closing: Promise<void> | undefined;
  const finish = async (): Promise<void> => {
    try {
      await sql.end();
    } finally {
      await onServer(serverUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  };
  return {
    name,
    url,
    db,
    sql,
    reset: async () => {
      if (tables.length > 0) await sql.unsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    },
    close: () => (closing ??= finish()),
  };
}
