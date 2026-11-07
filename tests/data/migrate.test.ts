import type { SqliteTestClient } from '../support/sqlite-db.ts';

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import packageJson from '../../package.json' with { type: 'json' };
import { migrateActive, migrateCommand, migratePg, migrateSqlite, migrationsFolderFor, MIGRATIONS_TABLE } from '../../src/data/migrate.ts';
import { captureLog } from '../support/capture-log.ts';
import { describePg, testPgUrl } from '../support/pg-gate.ts';
import { openMigratedMemoryDb } from '../support/sqlite-db.ts';

/** How many migrations a dialect's journal lists, read from the file drizzle-kit writes. */
function journalLength(dialect: 'sqlite' | 'pg'): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolderFor(dialect), 'meta', '_journal.json'), 'utf8'));
  return (journal as { entries: unknown[] }).entries.length;
}

const scratchFolders: string[] = [];
const openDatabases: Database[] = [];

afterEach(() => {
  for (const sqlite of openDatabases.splice(0)) sqlite.close();
  for (const folder of scratchFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function memoryDb() {
  const sqlite = new Database(':memory:');
  openDatabases.push(sqlite);
  return drizzle({ client: sqlite });
}

/** A copy of `drizzle/sqlite/` with one more migration, which adds a table, journalled after the rest. */
function folderWithOneMoreMigration(): string {
  const folder = mkdtempSync(join(tmpdir(), 'migrate-test-'));
  scratchFolders.push(folder);
  cpSync(migrationsFolderFor('sqlite'), folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[]
  };
  const last = journal.entries.at(-1);
  if (last === undefined) throw new Error('drizzle/sqlite/ has no migration to extend');
  const tag = `${String(last.idx + 1).padStart(4, '0')}_extra`;
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(folder, `${tag}.sql`), 'CREATE TABLE `extra` (`id` integer PRIMARY KEY NOT NULL);');
  return folder;
}

describe('migrationsFolderFor', () => {
  test('names drizzle/<dialect>/ at the repository root, as drizzle.config.ts does', () => {
    const root = join(import.meta.dir, '..', '..');
    expect(migrationsFolderFor('sqlite')).toBe(join(root, 'drizzle', 'sqlite'));
    expect(migrationsFolderFor('pg')).toBe(join(root, 'drizzle', 'pg'));
  });
});

describe('migrateSqlite', () => {
  test('applies every journalled migration to an empty database', () => {
    // Arrange
    const db = memoryDb();

    // Act
    const applied = migrateSqlite(db);

    // Assert
    expect(applied).toBe(journalLength('sqlite'));
    expect(applied).toBeGreaterThan(0);
    const tables = db.$client
      .query<{ name: string }, []>('select name from sqlite_master where type = \'table\' order by name')
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(['api_token', 'app_config', 'auth_session', MIGRATIONS_TABLE]));
  });

  test('a second run applies nothing and leaves the record as it was', () => {
    // Arrange
    const db = memoryDb();
    migrateSqlite(db);
    const recordQuery = `select hash, created_at from ${MIGRATIONS_TABLE} order by id`;
    const recordBefore = db.$client.query(recordQuery).all();

    // Act
    const applied = migrateSqlite(db);

    // Assert
    expect(applied).toBe(0);
    expect(db.$client.query(recordQuery).all()).toEqual(recordBefore);
  });

  test('control: a second run with a new migration in the folder applies that one only', () => {
    // Arrange
    const db = memoryDb();
    migrateSqlite(db);

    // Act
    const applied = migrateSqlite(db, folderWithOneMoreMigration());

    // Assert
    expect(applied).toBe(1);
    const extra = db.$client.query('select name from sqlite_master where type = \'table\' and name = \'extra\'').get();
    expect(extra).not.toBeNull();
  });

  test('the fixture database is already migrated, so migrating it again applies nothing', () => {
    const db: SqliteTestClient = openMigratedMemoryDb();
    try {
      expect(migrateSqlite(db)).toBe(0);
    } finally {
      db.$client.close();
    }
  });
});

describe('migrateActive', () => {
  test('migrates with the active dialect, and a second run applies nothing', async () => {
    // The active dialect in package.json is SQLite, so the database handed over is one.
    expect(packageJson.imports['#db']).toBe('./src/data/sqlite/index.ts');
    const db = openMigratedMemoryDb();
    try {
      const fresh = memoryDb() as unknown as SqliteTestClient;
      expect(await migrateActive(fresh)).toBe(journalLength('sqlite'));
      expect(await migrateActive(fresh)).toBe(0);
      expect(await migrateActive(db)).toBe(0);
    } finally {
      db.$client.close();
    }
  });
});

describe('migrateCommand', () => {
  test('signs its count line Db:migrate, with the apply step, and closes the database', async () => {
    const { log, records } = captureLog();
    let closed = 0;

    const exitCode = await migrateCommand({ migrate: async () => 2, close: async () => void closed++, log });

    expect(exitCode).toBe(0);
    expect(closed).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'info', domain: 'Db', scope: 'migrate', step: 'apply', applied: 2, msg: 'applied migrations' }),
    ]);
  });

  test('logs a failure by its driver code under Db:migrate, never by its message, and exits 1', async () => {
    const { log, records } = captureLog();
    const fault = Object.assign(new Error('secret postgres://user:pw@host/db'), { code: '28P01' });

    const exitCode = await migrateCommand({ migrate: async () => { throw fault; }, close: async () => {}, log });

    expect(exitCode).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'error', domain: 'Db', scope: 'migrate', step: 'apply', code: '28P01', msg: 'migration failed' }),
    ]);
    expect(JSON.stringify(records)).not.toContain('secret');
  });
});

describePg('migratePg', () => {
  test('a second run against TEST_PG_URL applies nothing', async () => {
    const sql = postgres(testPgUrl(), { max: 1, onnotice: () => {} });
    try {
      const db = drizzlePg(sql);
      await migratePg(db);
      expect(await migratePg(db)).toBe(0);
      const [row] = await sql.unsafe<{ count: string }[]>(`select count(*) as count from drizzle.${MIGRATIONS_TABLE}`);
      expect(Number(row?.count)).toBeGreaterThanOrEqual(journalLength('pg'));
    } finally {
      await sql.end();
    }
  });
});
