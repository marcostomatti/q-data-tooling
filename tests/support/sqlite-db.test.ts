import type { SqliteTestClient } from './sqlite-db.ts';

import { afterEach, describe, expect, test } from 'bun:test';

import { MIGRATIONS_TABLE } from '../../src/data/migrate.ts';

import { openMigratedMemoryDb } from './sqlite-db.ts';

const opened: SqliteTestClient[] = [];

/** Opens a migrated database that `afterEach` closes. */
function open(): SqliteTestClient {
  const db = openMigratedMemoryDb();
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.$client.close();
});

function tableNames(db: SqliteTestClient): string[] {
  const query = 'select name from sqlite_master where type = \'table\' and name not like \'sqlite_%\' order by name';
  return db.$client
    .query<{ name: string }, []>(query)
    .all()
    .map((row) => row.name);
}

/** The keys in `app_config`, read with SQL so the check compiles whichever dialect `#db` names. */
function configKeys(db: SqliteTestClient): string[] {
  return db.$client
    .query<{ key: string }, []>('select key from app_config order by key')
    .all()
    .map((row) => row.key);
}

describe('openMigratedMemoryDb', () => {
  test('opens :memory: with the migrated tables and the migration record', () => {
    // Act
    const db = open();

    // Assert
    expect(db.$client.filename).toBe(':memory:');
    expect(tableNames(db)).toEqual([MIGRATIONS_TABLE, 'api_token', 'app_config', 'auth_session', 'companies', 'company_tickers', 'filings']);
    const recorded = db.$client.query<{ count: number }, []>(`select count(*) as count from ${MIGRATIONS_TABLE}`).get();
    expect(recorded?.count).toBe(4);
  });

  test('gives each call a database of its own', () => {
    // Arrange
    const first = open();
    const second = open();

    // Act
    first.$client.run('insert into app_config (key, value) values (\'only-in-first\', \'1\')');

    // Assert
    expect(configKeys(first)).toEqual(['only-in-first']);
    expect(configKeys(second)).toEqual([]);
  });
});
