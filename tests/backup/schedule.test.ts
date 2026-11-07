import type { Spawner } from '../../src/backup/pg-dump.ts';
import type { Db } from '../../src/data/repositories/db.ts';
import type { Log } from '../../src/logging.ts';

import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createBackupDependency, runBackupOnce, startBackupSchedule, type BackupTimers } from '../../src/backup/schedule.ts';
import { appConfig, DIALECT } from '../../src/data/active.ts';
import { setBackupSettings } from '../../src/data/repositories/config.ts';
import { captureLog } from '../support/capture-log.ts';
import { openMigratedMemoryDb } from '../support/sqlite-db.ts';

import { flakyDb } from './db-proxies.ts';

const NOW = new Date('2026-11-03T09:05:07Z');
const NEW_DUMP = 'backup-20261103T090507Z.dump';
const URL_UNDER_TEST = 'postgres://backup_user:s3cret@db.example.test:5433/app_db';

/** Where the dumps go; each test lists it, so it holds nothing else. */
let outDir: string;
/** Holds the SQLite file the schedule dumps, apart from `outDir`. */
let sourceDir: string;
let sourceUrl: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'backup-schedule-'));
  sourceDir = await mkdtemp(join(tmpdir(), 'backup-source-'));
  const sourceFile = join(sourceDir, 'app.db');
  const source = new Database(sourceFile);
  source.run('CREATE TABLE marker (note TEXT NOT NULL)');
  source.run('INSERT INTO marker (note) VALUES (\'from the source\')');
  source.close();
  sourceUrl = `file:${sourceFile}`;
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
});

/**
 * Runs `body` on a fresh migrated SQLite `:memory:` database, which holds the settings the
 * schedule reads, and closes it afterwards. The dump itself is of the file at `sourceUrl`.
 */
async function withMigratedDb(body: (db: Db) => Promise<void>): Promise<void> {
  const db = openMigratedMemoryDb();
  try {
    await body(db);
  } finally {
    db.$client.close();
  }
}

/** The directory's entries in a fixed order, because `readdir` promises none. */
async function listing(): Promise<string[]> {
  return (await readdir(outDir)).sort();
}

/** Dumps already on disk, named as the dumpers name them. */
async function seedDumps(...names: string[]): Promise<void> {
  await Promise.all(names.map((name) => writeFile(join(outDir, name), 'old dump')));
}

/** The note the dump at `name` holds, read back by opening it as a database of its own. */
function noteIn(name: string): string | undefined {
  const restored = new Database(join(outDir, name), { readonly: true });
  try {
    return restored.query<{ note: string }, []>('SELECT note FROM marker').get()?.note;
  } finally {
    restored.close();
  }
}

type FakeTimers = BackupTimers & {
  readonly started: { readonly run: () => void; readonly ms: number }[]
  readonly cleared: unknown[]
};

function fakeTimers(): FakeTimers {
  const started: FakeTimers['started'] = [];
  const cleared: unknown[] = [];
  return {
    started,
    cleared,
    setInterval: (run, ms) => {
      started.push({ run, ms });
      return started.length;
    },
    clearInterval: (handle) => {
      cleared.push(handle);
    },
  };
}

const silent: Log = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

/** The schedule on the active dialect, which these tests run only when it is SQLite. */
function start(db: Db, extra: Partial<Parameters<typeof startBackupSchedule>[0]> = {}) {
  const timers = fakeTimers();
  const options = { db, outDir, databaseUrl: sourceUrl, now: () => NOW, timers, logger: silent, ...extra };
  return { timers, started: startBackupSchedule(options) };
}

test('these tests run on SQLite, the active dialect', () => {
  expect(DIALECT).toBe('sqlite');
});

describe('startBackupSchedule', () => {
  test('starts no timer and runs no dump when enabled is false', async () => {
    await withMigratedDb(async (db) => {
      await setBackupSettings(db, { enabled: false }, silent);
      const { timers, started } = start(db);

      const handle = await started;
      await handle.stop();

      expect(timers.started).toEqual([]);
      expect(timers.cleared).toEqual([]);
      expect(await listing()).toEqual([]);
    });
  });

  test('with no dialect named, dumps with the active one: a SQLite file that opens and holds the source row', async () => {
    await withMigratedDb(async (db) => {
      const spawned: string[] = [];
      const spawn: Spawner = async (request) => {
        spawned.push(request.command);
        return { exitCode: 1, signal: null, stderr: 'pg_dump must not run on SQLite' };
      };
      const { started } = start(db, { spawn });

      await (await started).stop();

      expect(spawned).toEqual([]);
      expect(await listing()).toEqual([NEW_DUMP]);
      expect(noteIn(NEW_DUMP)).toBe('from the source');
    });
  });

  test('control: naming the pg dialect runs pg_dump instead, so the test above could have failed', async () => {
    await withMigratedDb(async (db) => {
      const spawned: string[] = [];
      const spawn: Spawner = async (request) => {
        spawned.push(request.command);
        return { exitCode: 1, signal: null, stderr: 'stand-in' };
      };
      const { started } = start(db, { dialect: 'pg', spawn, databaseUrl: URL_UNDER_TEST });

      await (await started).stop();

      expect(spawned).toHaveLength(1);
      expect(await listing()).toEqual([]);
    });
  });

  test('reads keep and interval from app_config: a dump is due after the interval, and only keep files stay', async () => {
    await withMigratedDb(async (db) => {
      await setBackupSettings(db, { keep: 2, intervalDays: 3 }, silent);
      await seedDumps('backup-20260920T000000Z.dump', 'backup-20261001T000000Z.dump', 'backup-20261030T090507Z.dump');
      const { started } = start(db);

      await (await started).stop();

      // newest is 4 days old and the interval is 3, so a dump was made; keep = 2 leaves it and the previous newest
      expect(await listing()).toEqual(['backup-20261030T090507Z.dump', NEW_DUMP]);
    });
  });

  test('makes no dump while the newest is younger than the interval', async () => {
    await withMigratedDb(async (db) => {
      await setBackupSettings(db, { keep: 2, intervalDays: 3 }, silent);
      await seedDumps('backup-20261101T090507Z.dump');
      const { started } = start(db);

      await (await started).stop();

      expect(await listing()).toEqual(['backup-20261101T090507Z.dump']);
    });
  });

  test('defaults to one kept dump a fortnight apart when nothing is stored, and the first start makes one', async () => {
    await withMigratedDb(async (db) => {
      await seedDumps('backup-20261001T000000Z.dump');
      const { started } = start(db);

      await (await started).stop();

      expect(await listing()).toEqual([NEW_DUMP]);
    });
  });

  test('arms one timer that checks well inside any interval, and stop() clears it', async () => {
    await withMigratedDb(async (db) => {
      const { timers, started } = start(db);

      const handle = await started;
      expect(timers.started).toHaveLength(1);
      // timer delays above 2^31 - 1 ms fire at once, so a check period must stay far below it
      expect(timers.started[0]?.ms).toBeLessThanOrEqual(2 ** 31 - 1);
      expect(timers.cleared).toEqual([]);
      await handle.stop();

      expect(timers.cleared).toEqual([1]);
    });
  });

  test('a timer tick makes a dump once the interval has passed', async () => {
    await withMigratedDb(async (db) => {
      await setBackupSettings(db, { intervalDays: 1 }, silent);
      await seedDumps('backup-20261103T000000Z.dump');
      let current = NOW;
      const { timers, started } = start(db, { now: () => current });
      const handle = await started;
      expect(await listing()).toEqual(['backup-20261103T000000Z.dump']);

      current = new Date('2026-11-05T00:00:00Z');
      timers.started[0]?.run();
      await handle.stop();

      expect(await listing()).toEqual(['backup-20261105T000000Z.dump']);
    });
  });

  test('a timer tick rereads the settings, so switching backups off takes effect without a restart', async () => {
    await withMigratedDb(async (db) => {
      await setBackupSettings(db, { intervalDays: 1 }, silent);
      await seedDumps('backup-20261103T000000Z.dump');
      let current = NOW;
      const { timers, started } = start(db, { now: () => current });
      const handle = await started;

      current = new Date('2026-11-05T00:00:00Z');
      await setBackupSettings(db, { enabled: false }, silent);
      timers.started[0]?.run();
      await handle.stop();

      expect(await listing()).toEqual(['backup-20261103T000000Z.dump']);
    });
  });

  test('a settings read that fails at start does not end the schedule: the defaults make the due dump and the timer is armed', async () => {
    await withMigratedDb(async (real) => {
      // Arrange: a database whose first two selects fail, as a hiccup at boot would
      const flaky = flakyDb(real, 2);
      const logged: string[] = [];
      const logger: Log = { ...silent, error: (context, message) => void logged.push(JSON.stringify([context, message])), child: () => logger };
      const { timers, started } = start(flaky, { logger });

      // Act: start does not reject, and the failure is logged by class name only, at once
      const handle = await started;
      expect(timers.started).toHaveLength(1);
      expect(await listing()).toEqual([NEW_DUMP]);
      expect(logged.join('\n')).not.toContain('connection reset');
      expect(logged.some((line) => line.includes('could not be read'))).toBe(true);

      // Assert: the next hourly tick reads the settings again and finds the dump not yet due
      timers.started[0]?.run();
      await handle.stop();
      expect(await listing()).toEqual([NEW_DUMP]);
    });
  });

  test('a database that stays down logs a failure at each hourly check, so no one waits to learn why', async () => {
    await withMigratedDb(async (real) => {
      const logged: string[] = [];
      const logger: Log = { ...silent, error: (context, message) => void logged.push(JSON.stringify([context, message])), child: () => logger };
      const { timers, started } = start(flakyDb(real, Number.MAX_SAFE_INTEGER), { logger });
      const handle = await started;
      const afterStart = logged.length;

      timers.started[0]?.run();
      await until(() => logged.length > afterStart);
      const afterOneTick = logged.length;
      timers.started[0]?.run();
      await until(() => logged.length > afterOneTick);
      await handle.stop();

      expect(afterStart).toBeGreaterThan(0);
      // the first check dumps by the defaults; later ones find that dump not yet due
      expect(await listing()).toEqual([NEW_DUMP]);
      // each of the three paths (start, tick, tick) names the class and never the driver's message
      expect(logged.length).toBeGreaterThan(afterStart + 1);
      expect(logged.join('\n')).not.toContain('connection reset');
    });
  });

  test('a failing SQLite dump is logged without the path and does not stop the schedule or throw', async () => {
    await withMigratedDb(async (db) => {
      const logged: string[] = [];
      const logger: Log = { ...silent, error: (context, message) => void logged.push(JSON.stringify([context, message])), child: () => logger };
      const missing = join(sourceDir, 'missing.db');
      const { timers, started } = start(db, { databaseUrl: `file:${missing}`, logger });

      const handle = await started;
      await handle.stop();

      const text = logged.join('\n');
      expect(text).toContain('backup failed');
      expect(text).toContain('could not be opened');
      expect(text).not.toContain(missing);
      expect(timers.started).toHaveLength(1);
      expect(await listing()).toEqual([]);
    });
  });

  test('a failing pg dump is logged without the URL and does not stop the schedule or throw', async () => {
    await withMigratedDb(async (db) => {
      const logged: string[] = [];
      const record = (context: object, message: string) => void logged.push(JSON.stringify([context, message]));
      const logger: Log = { trace: record, debug: record, info: record, warn: record, error: record, child: () => logger };
      const spawn: Spawner = async () => ({ exitCode: 1, signal: null, stderr: `connect failed ${URL_UNDER_TEST}` });
      const { started } = start(db, { dialect: 'pg', spawn, databaseUrl: URL_UNDER_TEST, logger });

      const handle = await started;
      await handle.stop();

      const text = logged.join('\n');
      expect(text).toContain('connect failed');
      expect(text).not.toContain('s3cret');
      expect(text).not.toContain(URL_UNDER_TEST);
    });
  });
});

/** Waits, up to a few seconds, for something a timer tick does in the background. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(condition()).toBe(true);
}

/** A partial dump on disk whose last write was `ageMs` before `NOW`. */
async function seedPartial(name: string, ageMs: number): Promise<void> {
  const path = join(outDir, name);
  await writeFile(path, 'half a dump');
  const modified = new Date(NOW.getTime() - ageMs);
  await utimes(path, modified, modified);
}

const HOUR_MS = 3_600_000;
const STALE_PARTIAL = 'backup-20261020T000000Z.dump.partial';
const FRESH_PARTIAL = 'backup-20261103T090000Z.dump.partial';

describe('stale partial dumps', () => {
  test('are removed when the schedule starts, and a recent one, which may be a dump in flight, is left', async () => {
    await withMigratedDb(async (db) => {
      await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
      await seedPartial(FRESH_PARTIAL, 60_000);
      await seedDumps('backup-20261103T080000Z.dump');
      await writeFile(join(outDir, 'notes.partial'), 'not mine');
      const { started } = start(db);

      await (await started).stop();

      expect(await listing()).toEqual(['backup-20261103T080000Z.dump', FRESH_PARTIAL, 'notes.partial']);
    });
  });

  test('are removed by a one-off backup too', async () => {
    await withMigratedDb(async (db) => {
      await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);

      await runBackupOnce({ db, outDir, databaseUrl: sourceUrl, now: () => NOW, logger: silent });

      expect(await listing()).toEqual([NEW_DUMP]);
    });
  });

  test('are not removed when backups are off, because nothing is managing the directory then', async () => {
    await withMigratedDb(async (db) => {
      await setBackupSettings(db, { enabled: false }, silent);
      await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
      const { started } = start(db);

      await (await started).stop();

      expect(await listing()).toEqual([STALE_PARTIAL]);
    });
  });

  test('do not stand in for a backup: a directory with only a partial is still due a dump', async () => {
    await withMigratedDb(async (db) => {
      await seedPartial(FRESH_PARTIAL, 60_000);
      const { started } = start(db);

      await (await started).stop();

      expect(await listing()).toEqual([FRESH_PARTIAL, NEW_DUMP]);
    });
  });
});

describe('runBackupOnce', () => {
  test('dumps now whatever the interval says, then prunes to keep', async () => {
    await withMigratedDb(async (db) => {
      await setBackupSettings(db, { keep: 1 }, silent);
      await seedDumps('backup-20261103T090000Z.dump', 'backup-20261102T000000Z.dump');

      const result = await runBackupOnce({ db, outDir, databaseUrl: sourceUrl, now: () => NOW, logger: silent });

      expect(result.path).toBe(join(outDir, NEW_DUMP));
      expect(result.dropped).toBe(2);
      expect(await listing()).toEqual([NEW_DUMP]);
      expect(noteIn(NEW_DUMP)).toBe('from the source');
    });
  });

  test('leaves files that are not backups alone', async () => {
    await withMigratedDb(async (db) => {
      await writeFile(join(outDir, 'notes.txt'), 'keep me');
      await seedDumps('backup-20261001T000000Z.dump');

      await runBackupOnce({ db, outDir, databaseUrl: sourceUrl, now: () => NOW, logger: silent });

      expect(await listing()).toEqual([NEW_DUMP, 'notes.txt']);
    });
  });

  test('a failed dump prunes nothing, so the last good backup survives', async () => {
    await withMigratedDb(async (db) => {
      await seedDumps('backup-20261001T000000Z.dump');

      const run = runBackupOnce({ db, outDir, databaseUrl: `file:${join(sourceDir, 'missing.db')}`, now: () => NOW, logger: silent });

      await expect(run).rejects.toThrow(/could not be opened/);
      expect(await listing()).toEqual(['backup-20261001T000000Z.dump']);
    });
  });

  test('refuses a pg dump without a database URL, naming the variable', async () => {
    await withMigratedDb(async (db) => {
      const original = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        await expect(runBackupOnce({ db, outDir, dialect: 'pg', now: () => NOW, logger: silent })).rejects.toThrow(/DATABASE_URL/);
      } finally {
        if (original !== undefined) process.env.DATABASE_URL = original;
      }
    });
  });
});

describe('createBackupDependency', () => {
  test('starts the schedule on start and clears its timer on stop', async () => {
    await withMigratedDb(async (db) => {
      const timers = fakeTimers();
      const dependency = createBackupDependency({ db, outDir, databaseUrl: sourceUrl, now: () => NOW, timers, logger: silent });

      await dependency.start();
      expect(dependency.status).toBe('running');
      expect(timers.started).toHaveLength(1);
      await dependency.stop();

      expect(dependency.status).toBe('stopped');
      expect(timers.cleared).toEqual([1]);
      expect(await listing()).toEqual([NEW_DUMP]);
    });
  });
});

describe('the schedule\'s log signature', () => {
  test('signs what the schedule does before it returns as Backup:start', async () => {
    await withMigratedDb(async (db) => {
      // Arrange
      await setBackupSettings(db, { enabled: false }, silent);
      const { log, records } = captureLog();
      const { started } = start(db, { logger: log });

      // Act
      await (await started).stop();

      // Assert
      expect(records).toEqual([
        expect.objectContaining({ domain: 'Backup', scope: 'start', step: 'readSettings', msg: 'backups are off in app_config; no schedule started' }),
      ]);
    });
  });

  test('signs a check\'s dump as Backup:run', async () => {
    await withMigratedDb(async (db) => {
      // Arrange
      const { log, records } = captureLog();
      const { started } = start(db, { logger: log });

      // Act
      await (await started).stop();

      // Assert
      expect(records.find((record) => record.msg === 'backup written')).toMatchObject({
        domain: 'Backup', scope: 'run', step: 'dump', level: 'info', file: NEW_DUMP, dropped: 0,
      });
    });
  });

  test('signs a one-off backup as Backup:run', async () => {
    await withMigratedDb(async (db) => {
      // Arrange
      await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
      const { log, records } = captureLog();

      // Act
      await runBackupOnce({ db, outDir, databaseUrl: sourceUrl, now: () => NOW, logger: log });

      // Assert
      expect(records).toEqual([
        expect.objectContaining({ domain: 'Backup', scope: 'run', step: 'sweep', count: 1, msg: 'removed stale partial backups' }),
      ]);
    });
  });

  test('signs the config repository\'s fallback warning as Backup:run, on the log of the run\'s other lines', async () => {
    await withMigratedDb(async (db) => {
      // Arrange: a stored value that is not an object, and a stale partial so the run logs a line of its own
      await db.insert(appConfig).values({ key: 'backup', value: 'not an object', updatedAt: NOW });
      await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
      const { log, records } = captureLog();

      // Act
      await runBackupOnce({ db, outDir, databaseUrl: sourceUrl, now: () => NOW, logger: log });

      // Assert
      expect(records).toEqual([
        expect.objectContaining({ domain: 'Backup', scope: 'run', step: 'sweep', msg: 'removed stale partial backups' }),
        expect.objectContaining({
          domain: 'Backup',
          scope: 'run',
          step: 'parseSettings',
          level: 'warn',
          key: 'backup',
          msg: 'unusable backup settings in app_config; using the defaults',
        }),
      ]);
    });
  });
});
