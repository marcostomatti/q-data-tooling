import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import * as dialect from '../../../src/data/sqlite/index.ts';
import * as auth from '../../../src/data/sqlite/tables/auth.ts';
import * as config from '../../../src/data/sqlite/tables/config.ts';

/** Seconds a default timestamp may lie from the test's own clock, for a slow machine. */
const CLOCK_SLACK_SECONDS = 5;

/** The tables `schema/` declares, created on a fresh `:memory:` database from drizzle-kit's DDL. */
async function migratedMemoryDb(tables: Record<string, unknown>) {
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(tables),
  );
  const sqlite = new Database(':memory:');
  for (const statement of statements) sqlite.run(statement);
  return drizzle({ client: sqlite });
}

function nearNow(date: Date): boolean {
  return Math.abs(date.getTime() - Date.now()) <= CLOCK_SLACK_SECONDS * 1000;
}

let db: Awaited<ReturnType<typeof migratedMemoryDb>>;

beforeEach(async () => {
  db = await migratedMemoryDb({ ...auth, ...config });
});

describe('the SQLite schema', () => {
  test('declares only the auth tables and the app-config table', () => {
    const query = 'select name from sqlite_master where type = \'table\' and name not like \'sqlite_%\' order by name';
    const tables = db.$client
      .query<{ name: string }, []>(query)
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(['api_token', 'app_config', 'auth_session']);
  });

  test('the index exports its dialect, the client, the dependency and the three tables', () => {
    expect(dialect.DIALECT).toBe('sqlite');
    expect(Object.keys(dialect).sort()).toEqual([
      'DIALECT',
      'apiToken',
      'appConfig',
      'authSession',
      'closeDb',
      'dbDependency',
      'getDb',
      'transact',
    ]);
  });

  test('auth_session stores timestamps as epoch seconds and defaults created_at to now', () => {
    // Arrange
    const expiresAt = new Date('2030-01-02T03:04:05Z');

    // Act
    db.insert(auth.authSession).values({ idHash: 'abc', expiresAt })
      .run();
    const row = db.select().from(auth.authSession)
      .get();
    const raw = db.$client.query<{ expires_at: number }, []>('select expires_at from auth_session').get();

    // Assert
    expect(row?.expiresAt).toEqual(expiresAt);
    expect(raw?.expires_at).toBe(expiresAt.getTime() / 1000);
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(nearNow(row!.createdAt)).toBe(true);
  });

  test('control: a current_timestamp default reads back as an invalid date, so the now check can fail', async () => {
    // Arrange
    const textDefault = sqliteTable('text_default', {
      id: integer().primaryKey(),
      at: integer({ mode: 'timestamp' }).notNull()
        .default(sql`(current_timestamp)`),
    });
    const control = await migratedMemoryDb({ textDefault });

    // Act
    control.insert(textDefault).values({ id: 1 })
      .run();
    const row = control.select().from(textDefault)
      .get();

    // Assert
    expect(Number.isNaN(row!.at.getTime())).toBe(true);
  });

  test('api_token numbers its rows and refuses a second row with the same hash', () => {
    // Arrange
    const token = { name: 'agent', tokenHash: 'h1', prefix: 'tok_' };

    // Act
    const first = db.insert(auth.apiToken).values(token)
      .returning()
      .get();
    const second = db.insert(auth.apiToken).values({ ...token, tokenHash: 'h2' })
      .returning()
      .get();
    const duplicate = () => db.insert(auth.apiToken).values(token)
      .run();

    // Assert
    expect(second.id).toBe(first.id + 1);
    expect(nearNow(first.createdAt)).toBe(true);
    expect(first.lastUsedAt).toBeNull();
    expect(first.revokedAt).toBeNull();
    expect(duplicate).toThrow(/UNIQUE/);
  });

  test('app_config keeps a JSON value as it was given and stamps updated_at', () => {
    // Arrange
    const value = { enabled: true, keep: 7, folder: 'backups', tags: ['a', null] };

    // Act
    db.insert(config.appConfig).values({ key: 'backup', value })
      .run();
    const row = db.select().from(config.appConfig)
      .where(eq(config.appConfig.key, 'backup'))
      .get();

    // Assert
    expect(row?.value).toEqual(value);
    expect(nearNow(row!.updatedAt)).toBe(true);
  });
});
