/**
 * Helpers for the data layer's integration tests that `openTestDatabase` does not cover: a
 * scratch database with no migration applied, for the tests of the migrator and the migration
 * status, and a count of the transactions left open on a database.
 *
 * Both work on the server `DATABASE_URL` names (`.env.test`), as `openTestDatabase` does, and never
 * on the database that URL names.
 *
 * @module
 */

import type { ActiveClient } from '../../../src/data/active.ts';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseUrlFor, SCRATCH_PREFIX, SERVER_DATABASE, serverUrlOf } from '../../support/test-db.ts';

/** Options that quiet the client: a notice such as "schema does not exist, skipping" is not a test's concern. */
const QUIET = { max: 1, onnotice: () => {} } as const;

/** An empty scratch database: created, never migrated, dropped by {@link EmptyDatabase.close}. */
export interface EmptyDatabase {
  /** Its name, `SCRATCH_PREFIX` and a random suffix, as `openTestDatabase` names its own. */
  readonly name: string
  /** Its URL, for a child process that reads `DATABASE_URL`. */
  readonly url: string
  /** The drizzle client the migrator and the status readers are handed. */
  readonly db: ActiveClient
  /** The raw `postgres` handle, for checks written in SQL. */
  readonly sql: postgres.Sql
  /** Ends the connection and drops the database. Safe to call twice. */
  close(): Promise<void>
}

/** Runs `statement` on the server's own database, over a connection opened for it alone. */
async function onServer(serverUrl: string, statement: string): Promise<void> {
  const admin = postgres(databaseUrlFor(serverUrl, SERVER_DATABASE), QUIET);
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end();
  }
}

/**
 * Creates a scratch database with nothing in it, not even the migrations' record table.
 *
 * @returns The open database; close it in the test's `finally` or `afterEach`.
 * @throws {MissingTestDatabaseUrlError} when `DATABASE_URL` is unset.
 * @throws When the server does not answer: start it with `bun run db:up`.
 */
export async function openEmptyDatabase(): Promise<EmptyDatabase> {
  const serverUrl = serverUrlOf();
  const name = `${SCRATCH_PREFIX}${crypto.randomUUID().replaceAll('-', '')}`;
  const url = databaseUrlFor(serverUrl, name);
  await onServer(serverUrl, `CREATE DATABASE "${name}"`);
  const sql = postgres(url, QUIET);
  let closing: Promise<void> | undefined;
  const finish = async (): Promise<void> => {
    try {
      await sql.end();
    } finally {
      await onServer(serverUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  };
  return { name, url, db: drizzle(sql) as unknown as ActiveClient, sql, close: () => (closing ??= finish()) };
}

/**
 * How many connections to the database at `url` sit inside a transaction, between statements.
 * It reads on a connection of its own, so a transaction left open is counted rather than waited for.
 *
 * @param url - The database to look at.
 * @returns The count: 0 when no transaction is open.
 */
export async function openTransactions(url: string): Promise<number> {
  const observer = postgres(url, QUIET);
  try {
    const [row] = await observer<{ count: number }[]>`
      select count(*)::int as count from pg_stat_activity
      where datname = current_database() and state like 'idle in transaction%'`;
    return row?.count ?? -1;
  } finally {
    await observer.end();
  }
}
