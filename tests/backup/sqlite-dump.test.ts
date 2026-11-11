import { copyFile, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { BackupDumpError } from '../../src/backup/dump.ts';
import { createSqliteDumper } from '../../src/backup/sqlite-dump.ts';
import { openDatabase } from '../../src/data/sqlite/client.ts';

const NOW = new Date('2026-11-03T09:05:07Z');
const NEW_DUMP = 'backup-20261103T090507Z.dump';
const LATER = new Date('2026-11-04T10:00:00Z');
const LATER_DUMP = 'backup-20261104T100000Z.dump';

let workDir: string;
let outDir: string;
let sourceFile: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'sqlite-dump-'));
  outDir = join(workDir, 'backups');
  sourceFile = join(workDir, 'app.db');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** A WAL database with one row left in the WAL, as a running service would leave it. */
function seedSource(): Database {
  const sqlite = openDatabase(sourceFile);
  sqlite.run('CREATE TABLE note (body TEXT NOT NULL)');
  sqlite.run('INSERT INTO note (body) VALUES (?)', ['kept across the dump']);
  return sqlite;
}

/** A dump of `databaseUrl` into `outDir` at `NOW`. */
function dumpAt(databaseUrl: string, now: Date = NOW) {
  return createSqliteDumper({ databaseUrl, now: () => now }).dump(outDir);
}

/** The rows of `note` in the database file at `path`, opened read-only. */
function notesIn(path: string): unknown[] {
  const restored = new Database(path, { readonly: true });
  try {
    return restored.query('SELECT body FROM note').all();
  } finally {
    restored.close();
  }
}

describe('createSqliteDumper', () => {
  test('writes a private database file that restores into a fresh Database with the row in it', async () => {
    const open = seedSource();
    try {
      const result = await dumpAt(`file:${sourceFile}`);

      expect(result.file).toBe(join(outDir, NEW_DUMP));
      expect(result.bytes).toBe((await stat(result.file)).size);
      expect(result.bytes).toBeGreaterThan(0);
      expect((await stat(result.file)).mode & 0o777).toBe(0o600);
      expect((await stat(outDir)).mode & 0o777).toBe(0o700);
      expect(await readdir(outDir)).toEqual([NEW_DUMP]);
      expect(notesIn(result.file)).toEqual([{ body: 'kept across the dump' }]);
    } finally {
      open.close();
    }
  });

  test('control: a copy of the database file alone misses the row the WAL still holds', async () => {
    const open = seedSource();
    try {
      const copied = join(workDir, 'copied.db');
      await copyFile(sourceFile, copied);

      // Read-write, unlike notesIn: a read-only connection to a WAL file with no `-shm` beside
      // it fails to open on macOS, whose system SQLite Bun uses there, before it reads a page.
      // Read-write opens on both platforms and reads the main file alone, without the WAL.
      const reopened = new Database(copied);
      try {
        expect(() => reopened.query('SELECT body FROM note').all()).toThrow(/no such table/);
      } finally {
        reopened.close();
      }
    } finally {
      open.close();
    }
  });

  test('reads the clock at each dump, so each names its own file', async () => {
    const open = seedSource();
    let now = NOW;
    const dumper = createSqliteDumper({ databaseUrl: `file:${sourceFile}`, now: () => now });
    try {
      await dumper.dump(outDir);
      now = LATER;
      const second = await dumper.dump(outDir);

      expect(second.file).toBe(join(outDir, LATER_DUMP));
      expect((await readdir(outDir)).sort()).toEqual([NEW_DUMP, LATER_DUMP]);
    } finally {
      open.close();
    }
  });

  test('refuses an in-memory database, which a second connection would see empty', async () => {
    const run = dumpAt(':memory:');

    await expect(run).rejects.toBeInstanceOf(BackupDumpError);
    await expect(run).rejects.toThrow(/in-memory/);
  });

  test('refuses a Postgres URL without repeating it', async () => {
    const url = 'postgres://backup_user:s3cret@db.example.test:5433/app';
    const failure = await dumpAt(url).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BackupDumpError);
    expect(String((failure as Error).message)).not.toContain('s3cret');
    expect(String((failure as Error).message)).toContain('DATABASE_URL');
  });

  test('does not create a database that is not there, and leaves no file behind', async () => {
    const missing = join(workDir, 'missing.db');

    await expect(dumpAt(`file:${missing}`)).rejects.toBeInstanceOf(BackupDumpError);
    expect(await stat(missing).catch(() => null)).toBeNull();
    expect(await readdir(outDir)).toEqual([]);
  });
});
