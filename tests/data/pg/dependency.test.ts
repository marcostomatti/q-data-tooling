import type { DrizzleClient } from '../../../src/data/pg/client.ts';

import { createServer, type AddressInfo } from 'node:net';

import { afterEach, describe, expect, test } from 'bun:test';

import { closeDb, getDb } from '../../../src/data/pg/client.ts';
import { POSTGRES_DEPENDENCY_NAME, postgresDependency } from '../../../src/data/pg/dependency.ts';
import { captureLog } from '../../support/capture-log.ts';

// The dependency against a running server is tested in tests/integration/data/pg/dependency.test.ts.

const ORIGINAL_URL = process.env.DATABASE_URL;

/** A local port nothing listens on, so a connection to it is refused at once. */
async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((ready) => probe.listen(0, '127.0.0.1', () => ready()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** Starts `dependency` and returns `'started'` or the message it was refused with. */
async function startMessage(dependency: { start(): Promise<void> }): Promise<string> {
  return dependency.start().then(
    () => 'started',
    (error: Error) => error.message,
  );
}

afterEach(async () => {
  await closeDb();
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
});

describe('postgresDependency', () => {
  test('is named postgres and exposes the client', () => {
    // Arrange
    const db = { execute: async () => [] } as unknown as DrizzleClient;

    // Act
    const dependency = postgresDependency(db, captureLog().log);

    // Assert
    expect(POSTGRES_DEPENDENCY_NAME).toBe('postgres');
    expect(dependency.name).toBe('postgres');
    expect(dependency.client).toBe(db);
  });

  test('a failed start logs the driver code alone and throws its own message', async () => {
    // Arrange
    const secret = 'connect to postgres://u:hunter2@db.example.test/d failed';
    const fault = Object.assign(new Error(secret), { code: '28P01' });
    const db = { execute: async () => { throw fault; } } as unknown as DrizzleClient;
    const log = captureLog();
    const dependency = postgresDependency(db, log.log);

    // Act
    const message = await startMessage(dependency);

    // Assert
    expect(message).toBe('the database is unreachable; check DATABASE_URL and that Postgres is running');
    expect(dependency.status).toBe('error');
    expect(log.records).toEqual([
      { domain: 'Db', scope: 'ping', step: 'ping', code: '28P01', level: 'error', msg: 'database unreachable' },
    ]);
    expect(JSON.stringify(log.records)).not.toContain('hunter2');
  });

  test('a start against a port nothing listens on logs the refusal code and closes the pool', async () => {
    // Arrange
    process.env.DATABASE_URL = `postgres://u:hunter2@127.0.0.1:${await unusedPort()}/d`;
    const db = getDb();
    const log = captureLog();
    const dependency = postgresDependency(db, log.log);

    // Act
    const message = await startMessage(dependency);

    // Assert
    expect(message).toMatch(/^the database is unreachable/);
    expect(log.records).toEqual([
      { domain: 'Db', scope: 'ping', step: 'ping', code: 'ECONNREFUSED', level: 'error', msg: 'database unreachable' },
    ]);
    expect(getDb()).not.toBe(db);
  });
});
