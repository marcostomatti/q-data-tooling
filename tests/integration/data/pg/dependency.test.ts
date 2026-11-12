import type { TestDatabase } from '../../../support/test-db.ts';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { closeDb, getDb } from '../../../../src/data/pg/client.ts';
import { postgresDependency } from '../../../../src/data/pg/dependency.ts';
import { captureLog } from '../../../support/capture-log.ts';
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
  await database.close();
});

describe('postgresDependency against a scratch database', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = database.url;
  });

  test('starts on a reachable database without logging', async () => {
    // Arrange
    const log = captureLog();
    const dependency = postgresDependency(getDb(), log.log);

    // Act
    await dependency.start();

    // Assert
    expect(dependency.status).toBe('running');
    expect(log.records).toEqual([]);
  });

  test('stopping it closes the process-wide pool', async () => {
    // Arrange
    const db = getDb();
    const dependency = postgresDependency(db, captureLog().log);
    await dependency.start();

    // Act
    await dependency.stop();

    // Assert
    expect(dependency.status).toBe('stopped');
    expect(getDb()).not.toBe(db);
  });
});
