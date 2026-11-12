import type { SpawnRequest, Spawner } from '../../../src/backup/pg-dump.ts';
import type { Db } from '../../../src/data/repositories/db.ts';
import type { Log } from '../../../src/logging.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { createBackupDependency, runBackupOnce, startBackupSchedule, type BackupOptions, type BackupTimers } from '../../../src/backup/schedule.ts';
import { appConfig, DIALECT } from '../../../src/data/active.ts';
import { setBackupSettings } from '../../../src/data/repositories/config.ts';
import { flakyDb } from '../../backup/db-proxies.ts';
import { captureLog } from '../../support/capture-log.ts';
import { openTestDatabase } from '../../support/test-db.ts';

const NOW = new Date('2026-11-03T09:05:07Z');
const NEW_DUMP = 'backup-20261103T090507Z.dump';
const URL_UNDER_TEST = 'postgres://backup_user:s3cret@db.example.test:5433/app_db';

/** Holds the settings the schedule reads; its URL is the database the schedule dumps. */
let database: TestDatabase;
/** Where the dumps go; each test lists it, so it holds nothing else. */
let outDir: string;

beforeAll(async () => {
  database = await openTestDatabase();
});

beforeEach(async () => {
  await database.reset();
  outDir = await mkdtemp(join(tmpdir(), 'backup-schedule-'));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

afterAll(async () => {
  await database.close();
});

/** The path a dump was asked to write, read from the `--file=` argument the way pg_dump would. */
function targetOf(request: SpawnRequest): string {
  const arg = request.args.find((candidate) => candidate.startsWith('--file='));
  if (!arg) throw new Error('no --file argument');
  return arg.slice('--file='.length);
}

/** What the stand-in writes as the dump of the database `PGDATABASE` names. */
function standInDumpOf(databaseName: string | undefined): string {
  return `stand-in dump of ${databaseName ?? 'no database'}`;
}

/**
 * A stand-in for pg_dump: records the request, writes {@link standInDumpOf} the database it was
 * pointed at where it was told to, and exits 0. No test runs the real binary, whose version need
 * not match the server's.
 */
function standInPgDump(calls: SpawnRequest[] = []): Spawner {
  return async (request) => {
    calls.push(request);
    await writeFile(targetOf(request), standInDumpOf(request.env.PGDATABASE));
    return { exitCode: 0, signal: null, stderr: '' };
  };
}

/** The options every run here shares: the scratch database's URL, the stand-in pg_dump, a fixed clock and a silent log. */
function optionsFor(db: Db): BackupOptions {
  return { db, outDir, databaseUrl: database.url, spawn: standInPgDump(), now: () => NOW, logger: silent };
}

/** The directory's entries in a fixed order, because `readdir` promises none. */
async function listing(): Promise<string[]> {
  return (await readdir(outDir)).sort();
}

/** Dumps already on disk, named as the dumpers name them. */
async function seedDumps(...names: string[]): Promise<void> {
  await Promise.all(names.map((name) => writeFile(join(outDir, name), 'old dump')));
}

/** What the dump at `name` holds: the stand-in's text, which names the database it dumped. */
async function contentOf(name: string): Promise<string> {
  return readFile(join(outDir, name), 'utf8');
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

/** The schedule on the active dialect, Postgres, dumping through the stand-in unless `extra` says otherwise. */
function start(db: Db, extra: Partial<Parameters<typeof startBackupSchedule>[0]> = {}) {
  const timers = fakeTimers();
  const options = { ...optionsFor(db), timers, ...extra };
  return { timers, started: startBackupSchedule(options) };
}

test('these tests run on Postgres, the active dialect', () => {
  expect(DIALECT).toBe('pg');
});

describe('startBackupSchedule', () => {
  test('starts no timer and runs no dump when enabled is false', async () => {
    await setBackupSettings(database.db, { enabled: false }, silent);
    const { timers, started } = start(database.db);

    const handle = await started;
    await handle.stop();

    expect(timers.started).toEqual([]);
    expect(timers.cleared).toEqual([]);
    expect(await listing()).toEqual([]);
  });

  test('with no dialect named, dumps with the active one: pg_dump, pointed at the database it is given', async () => {
    const calls: SpawnRequest[] = [];
    const { started } = start(database.db, { spawn: standInPgDump(calls) });

    await (await started).stop();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.env.PGDATABASE).toBe(database.name);
    expect(await listing()).toEqual([NEW_DUMP]);
    expect(await contentOf(NEW_DUMP)).toBe(standInDumpOf(database.name));
  });

  test('reads keep and interval from app_config: a dump is due after the interval, and only keep files stay', async () => {
    await setBackupSettings(database.db, { keep: 2, intervalDays: 3 }, silent);
    await seedDumps('backup-20260920T000000Z.dump', 'backup-20261001T000000Z.dump', 'backup-20261030T090507Z.dump');
    const { started } = start(database.db);

    await (await started).stop();

    // newest is 4 days old and the interval is 3, so a dump was made; keep = 2 leaves it and the previous newest
    expect(await listing()).toEqual(['backup-20261030T090507Z.dump', NEW_DUMP]);
  });

  test('makes no dump while the newest is younger than the interval', async () => {
    await setBackupSettings(database.db, { keep: 2, intervalDays: 3 }, silent);
    await seedDumps('backup-20261101T090507Z.dump');
    const { started } = start(database.db);

    await (await started).stop();

    expect(await listing()).toEqual(['backup-20261101T090507Z.dump']);
  });

  test('defaults to one kept dump a fortnight apart when nothing is stored, and the first start makes one', async () => {
    await seedDumps('backup-20261001T000000Z.dump');
    const { started } = start(database.db);

    await (await started).stop();

    expect(await listing()).toEqual([NEW_DUMP]);
  });

  test('arms one timer that checks well inside any interval, and stop() clears it', async () => {
    const { timers, started } = start(database.db);

    const handle = await started;
    expect(timers.started).toHaveLength(1);
    // timer delays above 2^31 - 1 ms fire at once, so a check period must stay far below it
    expect(timers.started[0]?.ms).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(timers.cleared).toEqual([]);
    await handle.stop();

    expect(timers.cleared).toEqual([1]);
  });

  test('a timer tick makes a dump once the interval has passed', async () => {
    await setBackupSettings(database.db, { intervalDays: 1 }, silent);
    await seedDumps('backup-20261103T000000Z.dump');
    let current = NOW;
    const { timers, started } = start(database.db, { now: () => current });
    const handle = await started;
    expect(await listing()).toEqual(['backup-20261103T000000Z.dump']);

    current = new Date('2026-11-05T00:00:00Z');
    timers.started[0]?.run();
    await handle.stop();

    expect(await listing()).toEqual(['backup-20261105T000000Z.dump']);
  });

  test('a timer tick rereads the settings, so switching backups off takes effect without a restart', async () => {
    await setBackupSettings(database.db, { intervalDays: 1 }, silent);
    await seedDumps('backup-20261103T000000Z.dump');
    let current = NOW;
    const { timers, started } = start(database.db, { now: () => current });
    const handle = await started;

    current = new Date('2026-11-05T00:00:00Z');
    await setBackupSettings(database.db, { enabled: false }, silent);
    timers.started[0]?.run();
    await handle.stop();

    expect(await listing()).toEqual(['backup-20261103T000000Z.dump']);
  });

  test('a settings read that fails at start does not end the schedule: the defaults make the due dump and the timer is armed', async () => {
    // Arrange: a database whose first two selects fail, as a hiccup at boot would
    const flaky = flakyDb(database.db, 2);
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

  test('a database that stays down logs a failure at each hourly check, so no one waits to learn why', async () => {
    const logged: string[] = [];
    const logger: Log = { ...silent, error: (context, message) => void logged.push(JSON.stringify([context, message])), child: () => logger };
    const { timers, started } = start(flakyDb(database.db, Number.MAX_SAFE_INTEGER), { logger });
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

  test('a failing pg dump is logged without the URL and does not stop the schedule or throw', async () => {
    const logged: string[] = [];
    const record = (context: object, message: string) => void logged.push(JSON.stringify([context, message]));
    const logger: Log = { trace: record, debug: record, info: record, warn: record, error: record, child: () => logger };
    const spawn: Spawner = async () => ({ exitCode: 1, signal: null, stderr: `connect failed ${URL_UNDER_TEST}` });
    const { timers, started } = start(database.db, { spawn, databaseUrl: URL_UNDER_TEST, logger });

    const handle = await started;
    await handle.stop();

    const text = logged.join('\n');
    expect(text).toContain('backup failed');
    expect(text).toContain('connect failed');
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain(URL_UNDER_TEST);
    expect(timers.started).toHaveLength(1);
    expect(await listing()).toEqual([]);
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
    await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
    await seedPartial(FRESH_PARTIAL, 60_000);
    await seedDumps('backup-20261103T080000Z.dump');
    await writeFile(join(outDir, 'notes.partial'), 'not mine');
    const { started } = start(database.db);

    await (await started).stop();

    expect(await listing()).toEqual(['backup-20261103T080000Z.dump', FRESH_PARTIAL, 'notes.partial']);
  });

  test('are removed by a one-off backup too', async () => {
    await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);

    await runBackupOnce(optionsFor(database.db));

    expect(await listing()).toEqual([NEW_DUMP]);
  });

  test('are not removed when backups are off, because nothing is managing the directory then', async () => {
    await setBackupSettings(database.db, { enabled: false }, silent);
    await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
    const { started } = start(database.db);

    await (await started).stop();

    expect(await listing()).toEqual([STALE_PARTIAL]);
  });

  test('do not stand in for a backup: a directory with only a partial is still due a dump', async () => {
    await seedPartial(FRESH_PARTIAL, 60_000);
    const { started } = start(database.db);

    await (await started).stop();

    expect(await listing()).toEqual([FRESH_PARTIAL, NEW_DUMP]);
  });
});

describe('runBackupOnce', () => {
  test('dumps now whatever the interval says, then prunes to keep', async () => {
    await setBackupSettings(database.db, { keep: 1 }, silent);
    await seedDumps('backup-20261103T090000Z.dump', 'backup-20261102T000000Z.dump');

    const result = await runBackupOnce(optionsFor(database.db));

    expect(result.path).toBe(join(outDir, NEW_DUMP));
    expect(result.dropped).toBe(2);
    expect(await listing()).toEqual([NEW_DUMP]);
    expect(await contentOf(NEW_DUMP)).toBe(standInDumpOf(database.name));
  });

  test('leaves files that are not backups alone', async () => {
    await writeFile(join(outDir, 'notes.txt'), 'keep me');
    await seedDumps('backup-20261001T000000Z.dump');

    await runBackupOnce(optionsFor(database.db));

    expect(await listing()).toEqual([NEW_DUMP, 'notes.txt']);
  });

  test('a failed dump prunes nothing, so the last good backup survives', async () => {
    await seedDumps('backup-20261001T000000Z.dump');
    const spawn: Spawner = async (request) => {
      await writeFile(targetOf(request), 'half a dump');
      return { exitCode: 1, signal: null, stderr: 'connection refused' };
    };

    const run = runBackupOnce({ ...optionsFor(database.db), spawn });

    await expect(run).rejects.toThrow(/pg_dump exited with code 1/);
    expect(await listing()).toEqual(['backup-20261001T000000Z.dump']);
  });

  test('refuses a pg dump without a database URL, naming the variable', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(runBackupOnce({ ...optionsFor(database.db), databaseUrl: undefined })).rejects.toThrow(/DATABASE_URL/);
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
    }
  });
});

describe('createBackupDependency', () => {
  test('starts the schedule on start and clears its timer on stop', async () => {
    const timers = fakeTimers();
    const dependency = createBackupDependency({ ...optionsFor(database.db), timers });

    await dependency.start();
    expect(dependency.status).toBe('running');
    expect(timers.started).toHaveLength(1);
    await dependency.stop();

    expect(dependency.status).toBe('stopped');
    expect(timers.cleared).toEqual([1]);
    expect(await listing()).toEqual([NEW_DUMP]);
  });
});

describe('the schedule\'s log signature', () => {
  test('signs what the schedule does before it returns as Backup:start', async () => {
    // Arrange
    await setBackupSettings(database.db, { enabled: false }, silent);
    const { log, records } = captureLog();
    const { started } = start(database.db, { logger: log });

    // Act
    await (await started).stop();

    // Assert
    expect(records).toEqual([
      expect.objectContaining({ domain: 'Backup', scope: 'start', step: 'readSettings', msg: 'backups are off in app_config; no schedule started' }),
    ]);
  });

  test('signs a check\'s dump as Backup:run', async () => {
    // Arrange
    const { log, records } = captureLog();
    const { started } = start(database.db, { logger: log });

    // Act
    await (await started).stop();

    // Assert
    expect(records.find((record) => record.msg === 'backup written')).toMatchObject({
      domain: 'Backup', scope: 'run', step: 'dump', level: 'info', file: NEW_DUMP, dropped: 0,
    });
  });

  test('signs a one-off backup as Backup:run', async () => {
    // Arrange
    await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
    const { log, records } = captureLog();

    // Act
    await runBackupOnce({ ...optionsFor(database.db), logger: log });

    // Assert
    expect(records).toEqual([
      expect.objectContaining({ domain: 'Backup', scope: 'run', step: 'sweep', count: 1, msg: 'removed stale partial backups' }),
    ]);
  });

  test('signs the config repository\'s fallback warning as Backup:run, on the log of the run\'s other lines', async () => {
    // Arrange: a stored value that is not an object, and a stale partial so the run logs a line of its own
    await database.db.insert(appConfig).values({ key: 'backup', value: 'not an object', updatedAt: NOW });
    await seedPartial(STALE_PARTIAL, 3 * HOUR_MS);
    const { log, records } = captureLog();

    // Act
    await runBackupOnce({ ...optionsFor(database.db), logger: log });

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
