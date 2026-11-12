import type { TestDatabase } from '../../../support/test-db.ts';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import { closeDb, getDb } from '../../../../src/data/pg/client.ts';
import { openTestDatabase } from '../../../support/test-db.ts';

const ORIGINAL_URL = process.env.DATABASE_URL;

let database: TestDatabase;

beforeAll(async () => {
  database = await openTestDatabase();
});

afterEach(async () => {
  await closeDb();
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
});

afterAll(async () => {
  await closeDb();
  await database.close();
});

describe('getDb against a scratch database', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = database.url;
  });

  test('connects to the database named by DATABASE_URL', async () => {
    // Act
    const rows = await getDb().execute<{ one: number, name: string }>(sql`select 1 as one, current_database() as name`);

    // Assert
    expect(rows[0]?.one).toBe(1);
    expect(rows[0]?.name).toBe(database.name);
  });

  test('opens a working pool again after closeDb', async () => {
    // Arrange
    await getDb().execute(sql`select 1`);
    await closeDb();

    // Act
    const rows = await getDb().execute(sql`select 2 as two`);

    // Assert
    expect(rows[0]?.two).toBe(2);
  });
});
