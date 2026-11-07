import type { DrizzleClient } from '../../../src/data/sqlite/client.ts';

import { afterEach, describe, expect, test } from 'bun:test';

import { closeDb, getDb } from '../../../src/data/sqlite/client.ts';
import { SQLITE_DEPENDENCY_NAME, sqliteDependency } from '../../../src/data/sqlite/dependency.ts';
import { captureLog } from '../../support/capture-log.ts';

const ORIGINAL_URL = process.env.DATABASE_URL;

afterEach(async () => {
  await closeDb();
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
});

describe('sqliteDependency', () => {
  test('is named sqlite, exposes the client, and starts on an open database', async () => {
    // Arrange
    process.env.DATABASE_URL = ':memory:';
    const db = getDb();
    const log = captureLog();
    const dependency = sqliteDependency(db, log.log);

    // Act
    await dependency.start();

    // Assert
    expect(SQLITE_DEPENDENCY_NAME).toBe('sqlite');
    expect(dependency.name).toBe('sqlite');
    expect(dependency.client).toBe(db);
    expect(dependency.status).toBe('running');
    expect(log.records).toEqual([]);
  });

  test('stopping it closes the process-wide connection', async () => {
    // Arrange
    process.env.DATABASE_URL = ':memory:';
    const db = getDb();
    const dependency = sqliteDependency(db, captureLog().log);
    await dependency.start();

    // Act
    await dependency.stop();

    // Assert
    expect(dependency.status).toBe('stopped');
    expect(() => db.$client.query('select 1').get()).toThrow(/closed/);
    expect(getDb()).not.toBe(db);
  });

  test('a failed start logs the driver code alone and throws its own message', async () => {
    // Arrange
    const secret = 'select * from api_token where token_hash = hunter2';
    const fault = Object.assign(new Error(secret), { code: 'SQLITE_BUSY' });
    const db = { run: () => { throw fault; } } as unknown as DrizzleClient;
    const log = captureLog();
    const dependency = sqliteDependency(db, log.log);

    // Act
    const message = await dependency.start().then(
      () => 'started',
      (error: Error) => error.message,
    );

    // Assert
    expect(message).toMatch(/^the database is unreachable; check that DATABASE_URL/);
    expect(message).not.toContain('hunter2');
    expect(dependency.status).toBe('error');
    expect(log.records).toEqual([
      { domain: 'Db', scope: 'ping', step: 'ping', code: 'SQLITE_BUSY', level: 'error', msg: 'database unreachable' },
    ]);
    expect(JSON.stringify(log.records)).not.toContain('hunter2');
  });

  test('a start on a closed database fails and logs the unknown code', async () => {
    // Arrange
    process.env.DATABASE_URL = ':memory:';
    const db = getDb();
    await closeDb();
    const log = captureLog();
    const dependency = sqliteDependency(db, log.log);

    // Act
    const message = await dependency.start().then(
      () => 'started',
      (error: Error) => error.message,
    );

    // Assert
    expect(message).toMatch(/the database is unreachable/);
    expect(log.records).toEqual([
      { domain: 'Db', scope: 'ping', step: 'ping', code: 'unknown', level: 'error', msg: 'database unreachable' },
    ]);
  });
});
