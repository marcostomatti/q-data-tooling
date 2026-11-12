import type { EmptyDatabase } from './scratch.ts';
import type { StatusLine } from '../../../src/data/migration-status.ts';

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import packageJson from '../../../package.json' with { type: 'json' };
import { migratePg, migrationsFolderFor, MIGRATIONS_TABLE, PG_MIGRATIONS_SCHEMA } from '../../../src/data/migrate.ts';
import { classifyMigrations, migrationStatusActive, readJournalMigrations, readPgRows, statusExitCode } from '../../../src/data/migration-status.ts';

import { openEmptyDatabase } from './scratch.ts';

/** The journal's shape, as far as these tests rewrite it. */
type Journal = { entries: { idx: number, version: string, when: number, tag: string, breakpoints: boolean }[] };

const scratchFolders: string[] = [];
const databases: EmptyDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  for (const folder of scratchFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/**
 * A scratch database of the test's own, closed after it. Each test gets one, because the record of
 * applied migrations lives in the `drizzle` schema, which `TestDatabase.reset` leaves as it is.
 */
async function emptyDb(): Promise<EmptyDatabase> {
  const database = await openEmptyDatabase();
  databases.push(database);
  return database;
}

/** A migrated scratch database of the test's own, migrated from `folder`. */
async function migratedDb(folder: string = migrationsFolderFor('pg')): Promise<EmptyDatabase> {
  const database = await emptyDb();
  await migratePg(database.db, folder);
  return database;
}

/** A copy of `drizzle/pg/`, so a test can add to it or edit it. */
function copyOfPgFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'migration-status-'));
  scratchFolders.push(folder);
  cpSync(migrationsFolderFor('pg'), folder, { recursive: true });
  return folder;
}

/**
 * Adds a migration that creates a table to a migrations folder, journalled last with the `when`
 * `whenOf` derives from the folder's current newest entry.
 */
function addMigration(folder: string, whenOf: (newest: number) => number): string {
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  const last = journal.entries.at(-1);
  if (last === undefined) throw new Error('the folder has no migration to extend');
  const tag = `${String(last.idx + 1).padStart(4, '0')}_extra`;
  journal.entries.push({ ...last, idx: last.idx + 1, when: whenOf(last.when), tag });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(folder, `${tag}.sql`), 'CREATE TABLE "extra" ("id" integer PRIMARY KEY NOT NULL);');
  return tag;
}

/** Whether `public.<name>` exists, read with SQL. */
async function tableExists(database: EmptyDatabase, name: string): Promise<boolean> {
  const [row] = await database.sql<{ present: boolean }[]>`select to_regclass(${`public.${name}`}) is not null as present`;
  return row?.present === true;
}

describe('readPgRows', () => {
  test('reads no rows from a database that has no record table', async () => {
    const database = await emptyDb();

    expect(await readPgRows(database.db)).toEqual([]);
  });

  test('every migration of a freshly migrated database reads as applied', async () => {
    const database = await migratedDb();

    const rows = await readPgRows(database.db);
    expect(rows.every((row) => Number.isFinite(row.createdAt))).toBe(true);
    const lines = classifyMigrations(readJournalMigrations(migrationsFolderFor('pg')), rows);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.state === 'applied')).toBe(true);
    expect(statusExitCode(lines)).toBe(0);
  });

  test('reads no rows once the record table is gone, so every migration is pending', async () => {
    const database = await migratedDb();
    await database.db.execute(sql`drop schema drizzle cascade`);

    const rows = await readPgRows(database.db);
    expect(rows).toEqual([]);
    const lines = classifyMigrations(readJournalMigrations(migrationsFolderFor('pg')), rows);
    expect(lines.every((line) => line.state === 'pending')).toBe(true);
  });

  test('a migration journalled with an older when than the applied ones is skipped, and the migrator skips it', async () => {
    // Arrange: the shipped migrations are applied, then one is added with a when before the newest.
    const folder = copyOfPgFolder();
    const database = await migratedDb(folder);
    const tag = addMigration(folder, (newest) => newest - 1);

    // Act
    const applied = await migratePg(database.db, folder);
    const lines = classifyMigrations(readJournalMigrations(folder), await readPgRows(database.db));

    // Assert: drizzle ran nothing and said nothing, and the status names the file.
    expect(applied).toBe(0);
    expect(await tableExists(database, 'extra')).toBe(false);
    expect(lines.at(-1)).toMatchObject({ state: 'skipped', tag });
    expect(statusExitCode(lines)).toBe(1);
  });

  test('control: the same migration with a later when is pending, and the migrator runs it', async () => {
    // Arrange
    const folder = copyOfPgFolder();
    const database = await migratedDb(folder);
    const tag = addMigration(folder, (newest) => newest + 1);

    // Act
    const before = classifyMigrations(readJournalMigrations(folder), await readPgRows(database.db));
    const applied = await migratePg(database.db, folder);
    const after = classifyMigrations(readJournalMigrations(folder), await readPgRows(database.db));

    // Assert
    expect(before.at(-1)).toMatchObject({ state: 'pending', tag });
    expect(statusExitCode(before)).toBe(0);
    expect(applied).toBe(1);
    expect(await tableExists(database, 'extra')).toBe(true);
    expect(after.every((line) => line.state === 'applied')).toBe(true);
  });

  test('a file edited after it was applied leaves an unknown row', async () => {
    // Arrange: one migration more than the template ships, as after a `/db add`.
    const folder = copyOfPgFolder();
    addMigration(folder, (newest) => newest + 1);
    const database = await migratedDb(folder);
    const [init, ...later] = readJournalMigrations(folder);
    if (init === undefined) throw new Error('drizzle/pg/ has no migration');
    const path = join(folder, `${init.tag}.sql`);
    writeFileSync(path, `${readFileSync(path).toString()}\n-- edited`);

    // Act
    const lines = classifyMigrations(readJournalMigrations(folder), await readPgRows(database.db));

    // Assert: the edited file is skipped, every later one stays applied, and the old row is
    // unknown; the expectation reads the journal, so it holds whatever `/db add` appended.
    expect(lines).toEqual([
      { state: 'skipped', tag: init.tag, when: init.when },
      ...later.map(({ tag, when }): StatusLine => ({ state: 'applied', tag, when })),
      { state: 'unknown', hash: init.hash, createdAt: init.when },
    ]);
  });
});

describe('migrationStatusActive', () => {
  test('reads the active dialect\'s folder and database', async () => {
    // The active dialect in package.json is Postgres, so the database handed over is one.
    expect(packageJson.imports['#db']).toBe('./src/data/pg/index.ts');
    const database = await migratedDb();

    const lines = await migrationStatusActive(database.db);

    expect(lines.map((line) => line.state))
      .toEqual(readJournalMigrations(migrationsFolderFor('pg')).map(() => 'applied'));
  });
});

describe('bun run db:status as a child process', () => {
  const repoRoot = resolve(import.meta.dir, '..', '..', '..');

  async function run(script: string, databaseUrl: string) {
    const child = Bun.spawn(['bun', 'run', script], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { stdout, exitCode };
  }

  test('prints every migration applied and exits 0 on a freshly migrated database', async () => {
    // Arrange
    const database = await emptyDb();
    expect((await run('db:migrate', database.url)).exitCode).toBe(0);

    // Act
    const status = await run('db:status', database.url);

    // Assert
    const expected = readJournalMigrations(migrationsFolderFor('pg'))
      .map((migration) => `applied ${migration.tag} (when ${migration.when})\n`)
      .join('');
    expect(status.stdout).toBe(expected);
    expect(status.exitCode).toBe(0);
  }, 30_000);

  test('control: a row that matches no file prints as unknown and exits 1', async () => {
    // Arrange
    const database = await emptyDb();
    expect((await run('db:migrate', database.url)).exitCode).toBe(0);
    await database.sql.unsafe(`insert into ${PG_MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at) values ('stray', 1)`);

    // Act
    const status = await run('db:status', database.url);

    // Assert
    expect(status.stdout).toContain('unknown row created_at 1: hash stray matches no migration file\n');
    expect(status.exitCode).toBe(1);
  }, 30_000);
});
