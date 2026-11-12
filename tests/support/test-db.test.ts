import { describe, expect, test } from 'bun:test';

import { databaseUrlFor, MissingTestDatabaseUrlError, serverUrlOf } from './test-db.ts';

const SERVER = 'postgres://u:p@localhost:5432/named';

describe('serverUrlOf', () => {
  test('returns DATABASE_URL as it is set', () => {
    expect(serverUrlOf({ DATABASE_URL: SERVER })).toBe(SERVER);
  });

  test('refuses an unset or empty DATABASE_URL, naming the command that loads .env.test', () => {
    expect(() => serverUrlOf({})).toThrow(MissingTestDatabaseUrlError);
    expect(() => serverUrlOf({ DATABASE_URL: '' })).toThrow(/bun run test:integration/);
  });
});

describe('databaseUrlFor', () => {
  test('keeps the server and the credentials and swaps the database', () => {
    expect(databaseUrlFor(SERVER, 'scratch_1')).toBe('postgres://u:p@localhost:5432/scratch_1');
  });
});
