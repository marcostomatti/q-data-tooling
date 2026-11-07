import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import {
  closeDb,
  databasePath,
  DEFAULT_DATABASE_PATH,
  getDb,
  InvalidDatabaseUrlError,
  MEMORY_DATABASE,
  openDatabase,
} from '../../../src/data/sqlite/client.ts';

const ORIGINAL_URL = process.env.DATABASE_URL;
const ORIGINAL_CWD = process.cwd();

/** Folders made by a test, removed after it. */
const scratch: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-client-'));
  scratch.push(dir);
  return dir;
}

function journalMode(sqlite: Database): string | undefined {
  return sqlite.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode;
}

afterEach(async () => {
  await closeDb();
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('databasePath', () => {
  test('falls back to ./data/app.db when DATABASE_URL is unset or empty', () => {
    expect(DEFAULT_DATABASE_PATH).toBe('./data/app.db');
    expect(databasePath(undefined)).toBe(DEFAULT_DATABASE_PATH);
    expect(databasePath('')).toBe(DEFAULT_DATABASE_PATH);
  });

  test('keeps :memory: and takes the path after file:', () => {
    expect(databasePath(':memory:')).toBe(MEMORY_DATABASE);
    expect(databasePath('file:./elsewhere/x.db')).toBe('./elsewhere/x.db');
    expect(databasePath('file:/abs/x.db')).toBe('/abs/x.db');
  });

  test('refuses a URL of another dialect without repeating it', () => {
    // Arrange
    const url = 'postgres://user:hunter2@localhost:5432/app';

    // Act
    const act = () => databasePath(url);

    // Assert
    expect(act).toThrow(InvalidDatabaseUrlError);
    expect(act).not.toThrow(/hunter2/);
  });

  test('refuses file: with no path after it', () => {
    expect(() => databasePath('file:')).toThrow(InvalidDatabaseUrlError);
  });
});

describe('openDatabase', () => {
  test('creates the missing folder of a file path and opens it in WAL mode', () => {
    // Arrange
    const folder = join(scratchDir(), 'nested', 'deeper');
    const path = join(folder, 'app.db');
    expect(existsSync(folder)).toBe(false);

    // Act
    const sqlite = openDatabase(path);

    // Assert
    expect(existsSync(path)).toBe(true);
    expect(journalMode(sqlite)).toBe('wal');
    sqlite.close();
  });

  test('control: a file opened without it keeps the rollback journal, so the WAL check can fail', () => {
    // Arrange
    const sqlite = new Database(join(scratchDir(), 'plain.db'));

    // Act
    const mode = journalMode(sqlite);

    // Assert
    expect(mode).toBe('delete');
    sqlite.close();
  });

  test('opens :memory: with its in-memory journal and no folder', () => {
    // Arrange
    const dir = scratchDir();
    process.chdir(dir);

    // Act
    const sqlite = openDatabase(MEMORY_DATABASE);

    // Assert
    expect(journalMode(sqlite)).toBe('memory');
    expect(existsSync(join(dir, MEMORY_DATABASE))).toBe(false);
    sqlite.close();
  });
});

describe('getDb', () => {
  test('opens ./data/app.db under the working directory when DATABASE_URL is unset, creating ./data', () => {
    // Arrange
    const dir = scratchDir();
    process.chdir(dir);
    delete process.env.DATABASE_URL;
    expect(existsSync(join(dir, 'data'))).toBe(false);

    // Act
    const row = getDb().$client.query<{ one: number }, []>('select 1 as one').get();

    // Assert
    expect(row?.one).toBe(1);
    expect(existsSync(join(dir, 'data', 'app.db'))).toBe(true);
  });

  test('opens the file DATABASE_URL names, in WAL mode', () => {
    // Arrange
    const path = join(scratchDir(), 'named.db');
    process.env.DATABASE_URL = `file:${path}`;

    // Act
    const mode = journalMode(getDb().$client);

    // Assert
    expect(mode).toBe('wal');
    expect(existsSync(path)).toBe(true);
  });

  test('opens a private database for :memory:', () => {
    // Arrange
    process.env.DATABASE_URL = ':memory:';

    // Act
    const db = getDb();
    db.run(sql`create table t (n integer)`);
    db.run(sql`insert into t values (7)`);

    // Assert
    expect(db.$client.query<{ n: number }, []>('select n from t').get()?.n).toBe(7);
    expect(journalMode(db.$client)).toBe('memory');
  });

  test('reuses one client until closeDb, then reads DATABASE_URL again', async () => {
    // Arrange
    process.env.DATABASE_URL = ':memory:';
    const first = getDb();

    // Act
    const again = getDb();
    await closeDb();
    const reopened = getDb();

    // Assert
    expect(again).toBe(first);
    expect(reopened).not.toBe(first);
    expect(() => first.run(sql`select 1`)).toThrow();
  });

  test('throws a named error when DATABASE_URL names no SQLite database', () => {
    // Arrange
    process.env.DATABASE_URL = 'postgres://localhost/app';

    // Act
    const act = () => getDb();

    // Assert
    expect(act).toThrow(InvalidDatabaseUrlError);
  });
});

describe('closeDb', () => {
  test('is safe to call twice, and with nothing open', async () => {
    process.env.DATABASE_URL = ':memory:';
    getDb();
    await closeDb();
    await closeDb();
  });
});
