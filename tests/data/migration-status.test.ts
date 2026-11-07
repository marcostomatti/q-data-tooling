import type { JournalMigration, MigrationRow, StatusLine } from '../../src/data/migration-status.ts';

import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { readMigrationFiles } from 'drizzle-orm/migrator';

import packageJson from '../../package.json' with { type: 'json' };
import { migrateSqlite, migrationsFolderFor, MIGRATIONS_TABLE } from '../../src/data/migrate.ts';
import {
  classifyMigrations,
  formatStatusLine,
  migrationStatusActive,
  readJournalMigrations,
  readPgRows,
  readSqliteRows,
  statusCommand,
  statusExitCode,
} from '../../src/data/migration-status.ts';
import { captureLog } from '../support/capture-log.ts';
import { withMigratedPgDatabase } from '../support/pg-db.ts';
import { describePg } from '../support/pg-gate.ts';
import { openMigratedMemoryDb } from '../support/sqlite-db.ts';

/** The journal's shape, as far as these tests rewrite it. */
type Journal = { entries: { idx: number, version: string, when: number, tag: string, breakpoints: boolean }[] };

const scratchFolders: string[] = [];
const openDatabases: Database[] = [];

afterEach(() => {
  for (const sqlite of openDatabases.splice(0)) sqlite.close();
  for (const folder of scratchFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function scratchFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  scratchFolders.push(folder);
  return folder;
}

function memoryDb() {
  const sqlite = new Database(':memory:');
  openDatabases.push(sqlite);
  return drizzle({ client: sqlite });
}

/** A copy of `drizzle/sqlite/`, so a test can add to it or edit it. */
function copyOfSqliteFolder(): string {
  const folder = scratchFolder('migration-status-');
  cpSync(migrationsFolderFor('sqlite'), folder, { recursive: true });
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
  writeFileSync(join(folder, `${tag}.sql`), 'CREATE TABLE `extra` (`id` integer PRIMARY KEY NOT NULL);');
  return tag;
}

function tableExists(db: ReturnType<typeof memoryDb>, name: string): boolean {
  return db.$client.query('select name from sqlite_master where type = \'table\' and name = ?').get(name) !== null;
}

/** The byte-order mark an editor may prepend to a file. */
const BOM = '\uFEFF';

const first: JournalMigration = { tag: '0000_init', when: 1000, hash: 'hash-0' };
const second: JournalMigration = { tag: '0001_next', when: 2000, hash: 'hash-1' };
const third: JournalMigration = { tag: '0002_last', when: 3000, hash: 'hash-2' };

describe('classifyMigrations', () => {
  test('every migration is pending when the table is missing or empty', () => {
    expect(classifyMigrations([first, second], [])).toEqual([
      { state: 'pending', tag: '0000_init', when: 1000 },
      { state: 'pending', tag: '0001_next', when: 2000 },
    ]);
  });

  test('a migration whose hash is in the table is applied', () => {
    const rows: MigrationRow[] = [{ hash: 'hash-0', createdAt: 1000 }, { hash: 'hash-1', createdAt: 2000 }];
    expect(classifyMigrations([first, second], rows).map((line) => line.state)).toEqual(['applied', 'applied']);
  });

  test('an unapplied migration later than the newest created_at is pending', () => {
    const rows: MigrationRow[] = [{ hash: 'hash-0', createdAt: 1000 }];
    expect(classifyMigrations([first, second], rows)).toEqual([
      { state: 'applied', tag: '0000_init', when: 1000 },
      { state: 'pending', tag: '0001_next', when: 2000 },
    ]);
  });

  test('an unapplied migration older than the newest created_at is skipped', () => {
    // The merge case: `second` came from a branch, `third` from main, and main's ran first.
    const rows: MigrationRow[] = [{ hash: 'hash-0', createdAt: 1000 }, { hash: 'hash-2', createdAt: 3000 }];
    expect(classifyMigrations([first, second, third], rows).map((line) => line.state))
      .toEqual(['applied', 'skipped', 'applied']);
  });

  test('a when equal to the newest created_at is skipped, as the migrator compares strictly', () => {
    const rows: MigrationRow[] = [{ hash: 'other', createdAt: 2000 }];
    const [line] = classifyMigrations([second], rows);
    expect(line?.state).toBe('skipped');
  });

  test('a row whose hash matches no file is unknown, after the migration lines', () => {
    // `first` was edited after it was applied, so its row's hash is the old text's.
    const rows: MigrationRow[] = [{ hash: 'hash-0-before-edit', createdAt: 1000 }];
    expect(classifyMigrations([first], rows)).toEqual([
      { state: 'skipped', tag: '0000_init', when: 1000 },
      { state: 'unknown', hash: 'hash-0-before-edit', createdAt: 1000 },
    ]);
  });

  test('the newest created_at is the largest, whatever order the rows come in', () => {
    const rows: MigrationRow[] = [{ hash: 'hash-2', createdAt: 3000 }, { hash: 'hash-0', createdAt: 1000 }];
    expect(classifyMigrations([first, second, third], rows)[1]?.state).toBe('skipped');
  });
});

describe('statusExitCode', () => {
  const applied: StatusLine = { state: 'applied', tag: '0000_init', when: 1000 };
  const pending: StatusLine = { state: 'pending', tag: '0001_next', when: 2000 };

  test('is 0 when every line is applied or pending', () => {
    expect(statusExitCode([applied, pending])).toBe(0);
    expect(statusExitCode([])).toBe(0);
  });

  test('is 1 when a line is skipped or unknown', () => {
    expect(statusExitCode([applied, { state: 'skipped', tag: '0001_next', when: 2000 }])).toBe(1);
    expect(statusExitCode([applied, { state: 'unknown', hash: 'h', createdAt: 1000 }])).toBe(1);
  });
});

describe('formatStatusLine', () => {
  test('names the state, the tag and the when of a migration', () => {
    expect(formatStatusLine({ state: 'skipped', tag: '0001_next', when: 2000 })).toBe('skipped 0001_next (when 2000)');
  });

  test('names the created_at and the hash of an unknown row', () => {
    expect(formatStatusLine({ state: 'unknown', hash: 'abc', createdAt: 1000 }))
      .toBe('unknown row created_at 1000: hash abc matches no migration file');
  });
});

describe('readJournalMigrations', () => {
  test('hashes each file as drizzle\'s readMigrationFiles does, for both dialects', () => {
    for (const dialect of ['sqlite', 'pg'] as const) {
      const folder = migrationsFolderFor(dialect);
      const ours = readJournalMigrations(folder);
      const drizzles = readMigrationFiles({ migrationsFolder: folder });
      expect(ours.length).toBeGreaterThan(0);
      expect(ours.map(({ hash, when }) => ({ hash, when })))
        .toEqual(drizzles.map(({ hash, folderMillis }) => ({ hash, when: folderMillis })));
    }
  });

  test('keeps a BOM and CRLF line endings in the hashed text, as drizzle does', () => {
    // Arrange
    const folder = copyOfSqliteFolder();
    const [init] = readJournalMigrations(folder);
    if (init === undefined) throw new Error('drizzle/sqlite/ has no migration');
    const path = join(folder, `${init.tag}.sql`);
    const original = readFileSync(path).toString();
    const crlf = `${BOM}${original.replaceAll('\n', '\r\n')}`;
    writeFileSync(path, crlf);

    // Act
    const [edited] = readJournalMigrations(folder);

    // Assert
    expect(edited?.hash).toBe(createHash('sha256').update(crlf)
      .digest('hex'));
    expect(edited?.hash).not.toBe(init.hash);
    expect(edited?.hash).toBe(readMigrationFiles({ migrationsFolder: folder })[0]?.hash);
  });
});

describe('readSqliteRows', () => {
  test('reads no rows from a database that has no record table', () => {
    expect(readSqliteRows(memoryDb())).toEqual([]);
  });

  test('every migration of a freshly migrated database reads as applied', () => {
    const db = openMigratedMemoryDb();
    try {
      const lines = classifyMigrations(readJournalMigrations(migrationsFolderFor('sqlite')), readSqliteRows(db));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.state === 'applied')).toBe(true);
      expect(statusExitCode(lines)).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  test('a migration journalled with an older when than the applied ones is skipped, and the migrator skips it', () => {
    // Arrange: the init migration is applied, then one is added with a when before it.
    const db = memoryDb();
    const folder = copyOfSqliteFolder();
    migrateSqlite(db, folder);
    const tag = addMigration(folder, (newest) => newest - 1);

    // Act
    const applied = migrateSqlite(db, folder);
    const lines = classifyMigrations(readJournalMigrations(folder), readSqliteRows(db));

    // Assert: drizzle ran nothing and said nothing, and the status names the file.
    expect(applied).toBe(0);
    expect(tableExists(db, 'extra')).toBe(false);
    expect(lines.at(-1)).toMatchObject({ state: 'skipped', tag });
    expect(statusExitCode(lines)).toBe(1);
  });

  test('control: the same migration with a later when is pending, and the migrator runs it', () => {
    // Arrange
    const db = memoryDb();
    const folder = copyOfSqliteFolder();
    migrateSqlite(db, folder);
    const tag = addMigration(folder, (newest) => newest + 1);

    // Act
    const before = classifyMigrations(readJournalMigrations(folder), readSqliteRows(db));
    const applied = migrateSqlite(db, folder);
    const after = classifyMigrations(readJournalMigrations(folder), readSqliteRows(db));

    // Assert
    expect(before.at(-1)).toMatchObject({ state: 'pending', tag });
    expect(statusExitCode(before)).toBe(0);
    expect(applied).toBe(1);
    expect(tableExists(db, 'extra')).toBe(true);
    expect(after.every((line) => line.state === 'applied')).toBe(true);
  });

  test('a file edited after it was applied leaves an unknown row', () => {
    // Arrange: one migration more than the template ships, as after a `/db add`.
    const db = memoryDb();
    const folder = copyOfSqliteFolder();
    addMigration(folder, (newest) => newest + 1);
    migrateSqlite(db, folder);
    const [init, ...later] = readJournalMigrations(folder);
    if (init === undefined) throw new Error('drizzle/sqlite/ has no migration');
    const path = join(folder, `${init.tag}.sql`);
    writeFileSync(path, `${readFileSync(path).toString()}\n-- edited`);

    // Act
    const lines = classifyMigrations(readJournalMigrations(folder), readSqliteRows(db));

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
    // The active dialect in package.json is SQLite, so the database handed over is one.
    expect(packageJson.imports['#db']).toBe('./src/data/sqlite/index.ts');
    const db = openMigratedMemoryDb();
    try {
      const lines = await migrationStatusActive(db);
      expect(lines.map((line) => line.state))
        .toEqual(readJournalMigrations(migrationsFolderFor('sqlite')).map(() => 'applied'));
    } finally {
      db.$client.close();
    }
  });
});

describe('statusCommand', () => {
  test('prints one line per migration and logs nothing when the status reads', async () => {
    const { log, records } = captureLog();
    const printed: string[] = [];

    const exitCode = await statusCommand({
      status: async () => [{ state: 'applied', tag: '0000_init', when: 1 }],
      write: (text) => void printed.push(text),
      close: async () => {},
      log,
    });

    expect(exitCode).toBe(0);
    expect(printed).toEqual(['applied 0000_init (when 1)\n']);
    expect(records).toEqual([]);
  });

  test('logs a read failure by its driver code under Db:status, never by its message, and exits 1', async () => {
    const { log, records } = captureLog();
    let closed = 0;
    const fault = Object.assign(new Error('secret postgres://user:pw@host/db'), { code: 'SQLITE_CANTOPEN' });

    const exitCode = await statusCommand({
      status: async () => { throw fault; },
      write: () => {},
      close: async () => void closed++,
      log,
    });

    expect(exitCode).toBe(1);
    expect(closed).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'error', domain: 'Db', scope: 'status', step: 'read', code: 'SQLITE_CANTOPEN', msg: 'migration status failed' }),
    ]);
    expect(JSON.stringify(records)).not.toContain('secret');
  });
});

describe('bun run db:status as a child process', () => {
  const repoRoot = resolve(import.meta.dir, '..', '..');

  async function run(script: string, databaseFile: string) {
    const child = Bun.spawn(['bun', 'run', script], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { stdout, exitCode };
  }

  test('prints every migration applied and exits 0 on a freshly migrated database', async () => {
    // Arrange
    const databaseFile = join(scratchFolder('db-status-cli-'), 'status.sqlite');
    expect((await run('db:migrate', databaseFile)).exitCode).toBe(0);

    // Act
    const status = await run('db:status', databaseFile);

    // Assert
    const expected = readJournalMigrations(migrationsFolderFor('sqlite'))
      .map((migration) => `applied ${migration.tag} (when ${migration.when})\n`)
      .join('');
    expect(status.stdout).toBe(expected);
    expect(status.exitCode).toBe(0);
  }, 30_000);

  test('control: a row that matches no file prints as unknown and exits 1', async () => {
    // Arrange
    const databaseFile = join(scratchFolder('db-status-cli-'), 'status.sqlite');
    expect((await run('db:migrate', databaseFile)).exitCode).toBe(0);
    const sqlite = new Database(databaseFile);
    try {
      sqlite.run(`insert into ${MIGRATIONS_TABLE} (hash, created_at) values ('stray', 1)`);
    } finally {
      sqlite.close();
    }

    // Act
    const status = await run('db:status', databaseFile);

    // Assert
    expect(status.stdout).toContain('unknown row created_at 1: hash stray matches no migration file\n');
    expect(status.exitCode).toBe(1);
  }, 30_000);
});

describePg('readPgRows', () => {
  test('every migration of a freshly migrated Postgres database reads as applied', async () => {
    await withMigratedPgDatabase(async (db) => {
      const rows = await readPgRows(db);
      expect(rows.every((row) => Number.isFinite(row.createdAt))).toBe(true);
      const lines = classifyMigrations(readJournalMigrations(migrationsFolderFor('pg')), rows);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.state === 'applied')).toBe(true);
    });
  }, 30_000);

  test('reads no rows once the record table is gone, so every migration is pending', async () => {
    await withMigratedPgDatabase(async (db) => {
      await db.execute(sql`drop schema drizzle cascade`);
      const rows = await readPgRows(db);
      expect(rows).toEqual([]);
      const lines = classifyMigrations(readJournalMigrations(migrationsFolderFor('pg')), rows);
      expect(lines.every((line) => line.state === 'pending')).toBe(true);
    });
  }, 30_000);
});
