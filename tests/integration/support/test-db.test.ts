import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';

import { databaseUrlFor, openTestDatabase, SCRATCH_PREFIX, SERVER_DATABASE, serverUrlOf } from '../../support/test-db.ts';

/** Whether a database named `name` exists on the `.env.test` server, read on the server's own database. */
async function exists(name: string): Promise<boolean> {
  const admin = postgres(databaseUrlFor(serverUrlOf(), SERVER_DATABASE), { max: 1 });
  try {
    const rows = await admin`select 1 from pg_database where datname = ${name}`;
    return rows.length === 1;
  } finally {
    await admin.end();
  }
}

describe('openTestDatabase', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  test('creates a scratch database, never the one DATABASE_URL names', async () => {
    expect(database.name.startsWith(SCRATCH_PREFIX)).toBe(true);
    expect(database.url).toBe(databaseUrlFor(serverUrlOf(), database.name));
    expect(await exists(database.name)).toBe(true);
  });

  test('applies every migration, so the tables the repositories read exist', async () => {
    const rows = await database.sql<{ name: string }[]>`select tablename as name from pg_tables where schemaname = 'public'`;
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['app_config', 'companies', 'filings']));
  });

  test('reset empties the tables and keeps them', async () => {
    // Arrange
    await database.sql`insert into app_config (key, value) values ('probe', '"x"')`;

    // Act
    await database.reset();

    // Assert
    const rows = await database.sql`select key from app_config`;
    expect(rows).toHaveLength(0);
  });
});

describe('TestDatabase.close', () => {
  test('drops the database, and a second call does nothing more', async () => {
    // Arrange
    const database = await openTestDatabase();

    // Act
    await database.close();
    await database.close();

    // Assert
    expect(await exists(database.name)).toBe(false);
  });
});
