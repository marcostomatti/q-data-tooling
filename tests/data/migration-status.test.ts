import type { JournalMigration, MigrationRow, StatusLine } from '../../src/data/migration-status.ts';

import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';
import { readMigrationFiles } from 'drizzle-orm/migrator';

import { migrationsFolderFor } from '../../src/data/migrate.ts';
import {
  classifyMigrations,
  formatStatusLine,
  readJournalMigrations,
  statusCommand,
  statusExitCode,
} from '../../src/data/migration-status.ts';
import { captureLog } from '../support/capture-log.ts';

// The row readers and `bun run db:status` run against a database, in
// tests/integration/data/migration-status.test.ts.

const scratchFolders: string[] = [];

afterEach(() => {
  for (const folder of scratchFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A copy of `drizzle/pg/`, so a test can edit it. */
function copyOfPgFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'migration-status-'));
  scratchFolders.push(folder);
  cpSync(migrationsFolderFor('pg'), folder, { recursive: true });
  return folder;
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
    const folder = copyOfPgFolder();
    const [init] = readJournalMigrations(folder);
    if (init === undefined) throw new Error('drizzle/pg/ has no migration');
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
    const fault = Object.assign(new Error('secret postgres://user:pw@host/db'), { code: '3D000' });

    const exitCode = await statusCommand({
      status: async () => { throw fault; },
      write: () => {},
      close: async () => void closed++,
      log,
    });

    expect(exitCode).toBe(1);
    expect(closed).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'error', domain: 'Db', scope: 'status', step: 'read', code: '3D000', msg: 'migration status failed' }),
    ]);
    expect(JSON.stringify(records)).not.toContain('secret');
  });
});
