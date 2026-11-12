import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { closeDb, getDb, MissingDatabaseUrlError } from '../../../src/data/pg/client.ts';

// The pool against a running server is tested in tests/integration/data/pg/client.test.ts.

const ORIGINAL_URL = process.env.DATABASE_URL;

/** A URL whose pool is never asked to connect: `getDb` opens the pool lazily, so no server is needed. */
const UNREACHED_URL = 'postgres://u:p@127.0.0.1:1/never';

afterEach(async () => {
  await closeDb();
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
});

afterAll(async () => {
  await closeDb();
});

describe('getDb', () => {
  test('throws a named error when DATABASE_URL is absent', () => {
    // Arrange
    delete process.env.DATABASE_URL;

    // Act
    const act = () => getDb();

    // Assert
    expect(act).toThrow(MissingDatabaseUrlError);
    expect(act).toThrow(/DATABASE_URL/);
    expect(act).not.toThrow(TypeError);
  });

  test('throws the same error when DATABASE_URL is empty', () => {
    // Arrange
    process.env.DATABASE_URL = '';

    // Act
    const act = () => getDb();

    // Assert
    expect(act).toThrow(MissingDatabaseUrlError);
  });

  test('returns one client per process until it is closed', async () => {
    // Arrange
    process.env.DATABASE_URL = UNREACHED_URL;
    const first = getDb();

    // Act
    const second = getDb();
    await closeDb();
    const afterClose = getDb();

    // Assert
    expect(second).toBe(first);
    expect(afterClose).not.toBe(first);
  });

  test('reads DATABASE_URL again after closeDb', async () => {
    // Arrange
    process.env.DATABASE_URL = UNREACHED_URL;
    getDb();
    await closeDb();
    delete process.env.DATABASE_URL;

    // Act
    const act = () => getDb();

    // Assert
    expect(act).toThrow(MissingDatabaseUrlError);
  });
});

describe('closeDb', () => {
  test('is safe to call twice, and with nothing open', async () => {
    // Arrange
    process.env.DATABASE_URL = UNREACHED_URL;
    getDb();

    // Act
    const closing = async () => {
      await closeDb();
      await closeDb();
    };

    // Assert
    await expect(closing()).resolves.toBeUndefined();
  });
});
