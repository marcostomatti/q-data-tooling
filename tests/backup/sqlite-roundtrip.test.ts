import type { Log } from '../../src/logging.ts';
import type { SqliteTestClient } from '../support/sqlite-db.ts';

import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { runBackupOnce } from '../../src/backup/schedule.ts';
import { migrateSqlite } from '../../src/data/migrate.ts';
import { setBackupSettings } from '../../src/data/repositories/config.ts';
import { openDatabase } from '../../src/data/sqlite/client.ts';

const KEEP = 2;
const RUN_TIMES = [
  new Date('2026-11-01T09:00:00Z'),
  new Date('2026-11-02T09:00:00Z'),
  new Date('2026-11-03T09:00:00Z'),
];
const NAMES = ['backup-20261101T090000Z.dump', 'backup-20261102T090000Z.dump', 'backup-20261103T090000Z.dump'];

const silent: Log = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

let workDir: string;
let outDir: string;
let sourceFile: string;
let sqlite: Database;
let db: SqliteTestClient;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'backup-roundtrip-'));
  outDir = join(workDir, 'backups');
  await mkdir(outDir);
  sourceFile = join(workDir, 'app.db');
  sqlite = openDatabase(sourceFile);
  db = drizzle({ client: sqlite }) as unknown as SqliteTestClient;
  migrateSqlite(drizzle({ client: sqlite }));
  sqlite.run('CREATE TABLE marker (note TEXT NOT NULL)');
});

afterEach(async () => {
  sqlite.close();
  await rm(workDir, { recursive: true, force: true });
});

describe('backup run end to end on a temp SQLite file', () => {
  test('holds retention over three runs and the newest file restores the data written before it', async () => {
    await setBackupSettings(db, { keep: KEEP }, silent);

    for (const [index, time] of RUN_TIMES.entries()) {
      sqlite.run('INSERT INTO marker (note) VALUES (?)', [`row ${index}`]);
      await runBackupOnce({ db, outDir, databaseUrl: `file:${sourceFile}`, dialect: 'sqlite', now: () => time, logger: silent });
      expect((await readdir(outDir)).length).toBeLessThanOrEqual(KEEP);
    }

    expect((await readdir(outDir)).sort()).toEqual(NAMES.slice(1));
    const restored = new Database(join(outDir, NAMES[2]!), { readonly: true });
    try {
      const notes = restored.query<{ note: string }, []>('SELECT note FROM marker ORDER BY rowid').all()
        .map((row) => row.note);
      expect(notes).toEqual(['row 0', 'row 1', 'row 2']);
      const stored = restored.query<{ n: number }, []>('SELECT count(*) AS n FROM app_config WHERE key = \'backup\'').get();
      expect(stored?.n).toBe(1);
    } finally {
      restored.close();
    }
  });
});
