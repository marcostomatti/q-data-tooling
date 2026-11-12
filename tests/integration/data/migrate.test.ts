import type { EmptyDatabase } from './scratch.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

import packageJson from '../../../package.json' with { type: 'json' };
import { migrateActive, migratePg, migrationsFolderFor, MIGRATIONS_TABLE, PG_MIGRATIONS_SCHEMA } from '../../../src/data/migrate.ts';
import { openTestDatabase } from '../../support/test-db.ts';

import { openEmptyDatabase } from './scratch.ts';

/** How many migrations the Postgres journal lists, read from the file drizzle-kit writes. */
function journalLength(): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolderFor('pg'), 'meta', '_journal.json'), 'utf8'));
  return (journal as { entries: unknown[] }).entries.length;
}

const scratchFolders: string[] = [];
const emptyDatabases: EmptyDatabase[] = [];
let migrated: TestDatabase;

beforeAll(async () => {
  migrated = await openTestDatabase();
});

afterEach(async () => {
  await Promise.all(emptyDatabases.splice(0).map((database) => database.close()));
  for (const folder of scratchFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

afterAll(async () => {
  await migrated.close();
});

/** A scratch database with no migration applied, closed after the test. */
async function emptyDb(): Promise<EmptyDatabase> {
  const database = await openEmptyDatabase();
  emptyDatabases.push(database);
  return database;
}

/** A copy of `drizzle/pg/` with one more migration, which adds a table, journalled after the rest. */
function folderWithOneMoreMigration(): string {
  const folder = mkdtempSync(join(tmpdir(), 'migrate-test-'));
  scratchFolders.push(folder);
  cpSync(migrationsFolderFor('pg'), folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[]
  };
  const last = journal.entries.at(-1);
  if (last === undefined) throw new Error('drizzle/pg/ has no migration to extend');
  const tag = `${String(last.idx + 1).padStart(4, '0')}_extra`;
  journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(folder, `${tag}.sql`), 'CREATE TABLE "extra" ("id" integer PRIMARY KEY NOT NULL);');
  return folder;
}

/** The record of applied migrations, read with SQL, in the order they were applied. */
async function record(database: EmptyDatabase): Promise<{ hash: string; created_at: string }[]> {
  return database.sql.unsafe(`select hash, created_at from ${PG_MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by id`);
}

describe('migratePg', () => {
  test('applies every journalled migration to an empty database', async () => {
    // Arrange
    const database = await emptyDb();

    // Act
    const applied = await migratePg(database.db);

    // Assert
    expect(applied).toBe(journalLength());
    expect(applied).toBeGreaterThan(0);
    const rows = await database.sql<{ name: string }[]>`
      select table_name as name from information_schema.tables
      where table_schema in ('public', ${PG_MIGRATIONS_SCHEMA}) order by table_name`;
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['api_token', 'app_config', 'auth_session', MIGRATIONS_TABLE]));
  });

  test('a second run applies nothing and leaves the record as it was', async () => {
    // Arrange
    const database = await emptyDb();
    await migratePg(database.db);
    const recordBefore = await record(database);

    // Act
    const applied = await migratePg(database.db);

    // Assert
    expect(applied).toBe(0);
    expect(await record(database)).toEqual(recordBefore);
    expect(recordBefore).toHaveLength(journalLength());
  });

  test('control: a second run with a new migration in the folder applies that one only', async () => {
    // Arrange
    const database = await emptyDb();
    await migratePg(database.db);

    // Act
    const applied = await migratePg(database.db, folderWithOneMoreMigration());

    // Assert
    expect(applied).toBe(1);
    const [extra] = await database.sql<{ present: boolean }[]>`select to_regclass('public.extra') is not null as present`;
    expect(extra?.present).toBe(true);
  });

  test('the test database is already migrated, so migrating it again applies nothing', async () => {
    expect(await migratePg(migrated.db)).toBe(0);
  });
});

describe('migrateActive', () => {
  test('migrates with the active dialect, and a second run applies nothing', async () => {
    // The active dialect in package.json is Postgres, so the database handed over is one.
    expect(packageJson.imports['#db']).toBe('./src/data/pg/index.ts');
    const fresh = await emptyDb();

    expect(await migrateActive(fresh.db)).toBe(journalLength());
    expect(await migrateActive(fresh.db)).toBe(0);
    expect(await migrateActive(migrated.db)).toBe(0);
  });
});
