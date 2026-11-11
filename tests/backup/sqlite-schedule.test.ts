
import type { ActiveClient } from '../../src/data/active.ts';
import type { Log } from '../../src/logging.ts';
import type { Database } from 'bun:sqlite';

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { runBackupOnce, startBackupSchedule, type BackupTimers } from '../../src/backup/schedule.ts';
import { openDatabase, type DrizzleClient } from '../../src/data/sqlite/client.ts';
import { appConfig } from '../../src/data/sqlite/tables/config.ts';

const NOW = new Date('2026-11-03T09:05:07Z');
const NEW_DUMP = 'backup-20261103T090507Z.dump';
const OLD_DUMP = 'backup-20261001T000000Z.dump';

let workDir: string;
let outDir: string;
let sourceFile: string;
let sqlite: Database;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'sqlite-backup-'));
  outDir = join(workDir, 'backups');
  sourceFile = join(workDir, 'app.db');
  sqlite = openDatabase(sourceFile);
});

afterEach(async () => {
  sqlite.close();
  await rm(workDir, { recursive: true, force: true });
});

/** Creates `app_config` with the DDL drizzle-kit generates from the schema, as the migrations will. */
async function createAppConfig(): Promise<void> {
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson({ appConfig }),
  );
  for (const statement of statements) sqlite.run(statement);
}

const silent: Log = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };
const timers: BackupTimers = { setInterval: () => 'timer', clearInterval: () => {} };

/**
 * The test database's client. It is always a SQLite client, and carries the active dialect's type
 * too, so the file compiles under `bun run typecheck:pg`, where the repositories expect Postgres.
 */
function client(): ActiveClient & DrizzleClient {
  return drizzle({ client: sqlite }) as ActiveClient & DrizzleClient;
}

function options() {
  return { db: client(), outDir, databaseUrl: `file:${sourceFile}`, now: () => NOW, logger: silent };
}

async function seedOldDump(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, OLD_DUMP), 'old dump');
}

describe('backup on the SQLite dialect', () => {
  test('a one-off backup of a database with no app_config yet dumps and removes no older backup', async () => {
    await seedOldDump();
    const warned: string[] = [];

    const logger: Log = { ...silent, warn: (_context, message) => void warned.push(message), child: () => logger };
    const result = await runBackupOnce({ ...options(), logger });

    expect(result).toEqual({ path: join(outDir, NEW_DUMP), dropped: 0 });
    expect((await readdir(outDir)).sort()).toEqual([OLD_DUMP, NEW_DUMP]);
    expect(warned.some((message) => message.includes('no older backup was removed'))).toBe(true);
  });

  test('a one-off backup of a migrated database prunes to the stored keep', async () => {
    await createAppConfig();
    await seedOldDump();

    const result = await runBackupOnce(options());

    expect(result).toEqual({ path: join(outDir, NEW_DUMP), dropped: 1 });
    expect(await readdir(outDir)).toEqual([NEW_DUMP]);
  });

  test('a one-off backup keeps more when app_config says so', async () => {
    await createAppConfig();
    await client().insert(appConfig)
      .values({ key: 'backup', value: { keep: 2 } });
    await seedOldDump();

    const result = await runBackupOnce(options());

    expect(result.dropped).toBe(0);
    expect((await readdir(outDir)).sort()).toEqual([OLD_DUMP, NEW_DUMP]);
  });

  test('the schedule makes the due dump on a migrated database', async () => {
    await createAppConfig();

    const handle = await startBackupSchedule({ ...options(), timers });
    await handle.stop();

    expect(await readdir(outDir)).toEqual([NEW_DUMP]);
  });

  test('the schedule backs up a database with no app_config yet by the defaults, and prunes nothing', async () => {
    await seedOldDump();

    const handle = await startBackupSchedule({ ...options(), timers });
    await handle.stop();

    expect((await readdir(outDir)).sort()).toEqual([OLD_DUMP, NEW_DUMP]);
  });

  test('the schedule honours backups switched off in app_config', async () => {
    await createAppConfig();
    await client().insert(appConfig)
      .values({ key: 'backup', value: { enabled: false } });

    const handle = await startBackupSchedule({ ...options(), timers });
    await handle.stop();

    expect(await readdir(outDir).catch(() => [])).toEqual([]);
  });
});
