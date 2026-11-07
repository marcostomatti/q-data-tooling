import type { SpawnRequest, Spawner } from '../../src/backup/pg-dump.ts';
import type { BackupTimers } from '../../src/backup/schedule.ts';
import type { Log } from '../../src/logging.ts';
import type { ServiceHandle } from '@open-tomato/service-express';
import type { Server } from 'node:http';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import express from 'express';

import { APP } from '../../src/app-config.ts';
import { GENERATED_KEY_LENGTH } from '../../src/auth/api-key.ts';
import { closeDb, getDb, type ActiveClient } from '../../src/data/active.ts';
import { setBackupSettings } from '../../src/data/repositories/config.ts';
import { MEMORY_DATABASE } from '../../src/data/sqlite/client.ts';
import { APP_PATHS, backupOptionsFor, startService } from '../../src/http/server.ts';
import { countingDb } from '../backup/db-proxies.ts';
import { captureLog } from '../support/capture-log.ts';
import { startCapturingServers } from '../support/service-process.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

/**
 * A key made up for these tests; it matches nothing real. It is as long as a generated one, so
 * starting the service with it does not draw the short-key warning and add noise to every run.
 */
const TEST_KEY = 'test-key-for-the-server-entry-'.padEnd(GENERATED_KEY_LENGTH, 'k');

type Running = {
  readonly handle: ServiceHandle
  /** Every server `app.listen` created while the service started: the chassis's own is the first. */
  readonly chassisServers: readonly Server[]
};

const savedEnv = { apiKey: process.env.API_KEY, databaseUrl: process.env.DATABASE_URL, logLevel: process.env.LOG_LEVEL };
let running: Running | undefined;

/**
 * Starts the service in this process, on the `:memory:` database `beforeEach` names.
 * `startCapturingServers` collects the chassis's own server, so a test can see it listen and
 * close. No request is sent: a request is answered and logged by the chassis's request logger,
 * which has no level setting. The routes are tested without the service, in `routes.test.ts` and `handler.test.ts`.
 */
async function start(opts?: Parameters<typeof startService>[0]): Promise<Running> {
  const { handle, servers } = await startCapturingServers(opts);
  running = { handle, chassisServers: servers };
  return running;
}

async function stopRunning(): Promise<void> {
  const current = running;
  running = undefined;
  if (!current) return;
  await current.handle.stop();
}

/**
 * Reads `select 1` through `db`, written with the query builder so it runs on either dialect:
 * Postgres has `execute` for raw SQL and SQLite has `run`, but both take a `select … from` a
 * subquery, and neither needs a table for it.
 */
async function selectOne(db: ActiveClient): Promise<unknown> {
  return db.select({ one: sql<number>`1` }).from(sql`(select 1) as probe`);
}

// The chassis's service logger reads LOG_LEVEL when it is made, at each start. Nothing here
// reads what it writes.
beforeAll(() => {
  process.env.LOG_LEVEL = 'silent';
});

afterAll(() => {
  restore('LOG_LEVEL', savedEnv.logLevel);
});

beforeEach(async () => {
  process.env.API_KEY = TEST_KEY;
  // A private database that ends with its connection, so no test opens or writes a file.
  process.env.DATABASE_URL = MEMORY_DATABASE;
  await closeDb();
});

afterEach(async () => {
  await stopRunning();
  await closeDb();
  restore('API_KEY', savedEnv.apiKey);
  restore('DATABASE_URL', savedEnv.databaseUrl);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('startService', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
  ])('with API_KEY %s, refuses to start before the database or any listener is touched', async (_label, value) => {
    restore('API_KEY', value);
    // With DATABASE_URL naming no SQLite database, a key check that ran after the client opened
    // would surface the database's refusal instead of the key's, so the message tells the two
    // orders apart. The value is made up and names nothing.
    process.env.DATABASE_URL = 'postgres://nobody:unused@localhost:1/nothing';
    await closeDb();
    const listen = spyOn(express.application, 'listen');

    try {
      const failure = await startService().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/API_KEY/);
      expect((failure as Error).message).not.toMatch(/database/i);
      expect(listen).not.toHaveBeenCalled();
    } finally {
      listen.mockRestore();
    }
    expect(typeof express.application.listen).toBe('function');
  });

  test('the refusal names the fix', async () => {
    restore('API_KEY', undefined);

    const failure = await startService().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('setApiKey');
  });

  test.each([0, 70_000, 80.5, Number.NaN])('refuses a port option of %s before opening anything', async (port) => {
    await expect(startService({ port })).rejects.toThrow(/port option/);
  });

  test.each(['abc', '0', '70000', '80.5'])('refuses a PORT of %s before opening anything', async (value) => {
    const saved = process.env.PORT;
    process.env.PORT = value;

    try {
      await expect(startService()).rejects.toThrow(/PORT/);
    } finally {
      restore('PORT', saved);
    }
  });

  test('starts on the :memory: database DATABASE_URL names', async () => {
    const { chassisServers } = await start();

    expect(chassisServers[0]?.listening).toBe(true);
    expect(await selectOne(getDb())).toEqual([{ one: 1 }]);
  });

  test('a DATABASE_URL that names no SQLite database stops the start before anything listens', async () => {
    process.env.DATABASE_URL = 'postgres://nobody:unused@localhost:1/nothing';
    await closeDb();
    const listen = spyOn(express.application, 'listen');

    try {
      const failure = await startService().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/DATABASE_URL/);
      expect((failure as Error).message).not.toContain('unused');
      expect(listen).not.toHaveBeenCalled();
    } finally {
      listen.mockRestore();
    }
  });

  describe('the start lines', () => {
    /** A directory that does not exist, so the service finds no web bundle in it. */
    const NO_WEB_DIST = join(tmpdir(), 'no-web-bundle-here');

    test('a short API_KEY is warned about as Server:start, with its step and no key', async () => {
      process.env.API_KEY = 'short-key-made-up';
      const captured = captureLog();

      await start({ log: captured.log, webDist: NO_WEB_DIST });

      const warnings = captured.records.filter((record) => record.level === 'warn');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ domain: 'Server', scope: 'start', step: 'checkKey' });
      expect(JSON.stringify(captured.records)).not.toContain('short-key-made-up');
    });

    test('a key as long as a generated one draws no warning', async () => {
      const captured = captureLog();

      await start({ log: captured.log, webDist: NO_WEB_DIST });

      // The control for the test above: the same start, logged on the same fake, with a long key
      expect(captured.records.filter((record) => record.level === 'warn')).toEqual([]);
      expect(captured.records.length).toBeGreaterThan(0);
    });

    test('a missing web bundle is logged as Server:start with step serveWeb', async () => {
      const captured = captureLog();

      await start({ log: captured.log, webDist: NO_WEB_DIST });

      expect(captured.records).toEqual([
        { domain: 'Server', scope: 'start', step: 'serveWeb', webDist: 'absent', level: 'info', msg: 'no web bundle found; serving the API only' },
      ]);
    });
  });

  test('stop() closes the server and the database', async () => {
    const { handle, chassisServers } = await start();
    const db = getDb();
    await selectOne(db);
    expect(chassisServers[0]?.listening).toBe(true);

    await handle.stop();
    running = undefined;

    expect(chassisServers[0]?.listening).toBe(false);
    const afterStop = (async () => selectOne(db))();
    await expect(afterStop).rejects.toThrow();
  });

  describe('the backup schedule', () => {
    const silent: Log = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };
    /**
     * A made-up connection for a stand-in that never connects. The tests that gate the dump pass
     * the `'pg'` dialect and a stand-in for `pg_dump`, because SQLite's dump runs in-process and
     * cannot be held open; no Postgres server is reached.
     */
    const FAKE_URL = 'postgres://backup_user:s3cret@db.example.test:5433/app_db';
    let backupDir: string | undefined;

    afterEach(async () => {
      if (backupDir) await rm(backupDir, { recursive: true, force: true });
      backupDir = undefined;
    });

    /** Runs `use` on a fresh migrated `:memory:` database of its own, closed afterwards. */
    async function withMemoryDatabase(use: (scratch: SqliteTestClient) => Promise<void>): Promise<void> {
      const scratch = openMigratedMemoryDb();
      try {
        await use(scratch);
      } finally {
        scratch.$client.close();
      }
    }

    /** Waits, up to a few seconds, for a condition a background task will bring about. */
    async function until(condition: () => boolean): Promise<void> {
      const deadline = Date.now() + 5_000;
      while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(condition()).toBe(true);
    }

    test('is not started under NODE_ENV=test unless a test passes its own', () => {
      const own = { outDir: '/somewhere' };

      expect(backupOptionsFor({ NODE_ENV: 'test' }, undefined)).toBeUndefined();
      expect(backupOptionsFor({ NODE_ENV: 'production' }, undefined)).toEqual({});
      expect(backupOptionsFor({}, undefined)).toEqual({});
      expect(backupOptionsFor({ NODE_ENV: 'test' }, own)).toBe(own);
    });

    test('does not hold the service back while a due dump runs, and stop() clears its timer', async () => {
      await withMemoryDatabase(async (scratch) => {
        // Arrange: a stand-in whose dump does not finish until the test says so
        backupDir = await mkdtemp(join(tmpdir(), 'service-backups-'));
        const calls: SpawnRequest[] = [];
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const spawn: Spawner = async (request) => {
          calls.push(request);
          await gate;
          const target = request.args.find((arg) => arg.startsWith('--file='))?.slice('--file='.length) ?? '';
          await writeFile(target, 'a dump');
          return { exitCode: 0, signal: null, stderr: '' };
        };
        const cleared: unknown[] = [];
        const timers: BackupTimers = { setInterval: () => 'timer', clearInterval: (handle) => void cleared.push(handle) };

        try {
          // Act: startService resolves although the first check is waiting on the gate
          const { chassisServers } = await start({ backup: { dialect: 'pg', db: scratch, outDir: backupDir, spawn, timers, databaseUrl: FAKE_URL, logger: silent } });
          await until(() => calls.length === 1);

          // Assert: the dump is still in flight and the service already listens
          expect(chassisServers[0]?.listening).toBe(true);
          expect(cleared).toEqual([]);
        } finally {
          release();
        }
        await stopRunning();
        expect(cleared).toEqual(['timer']);
      });
    });

    test('reads its settings from the database it is given, so a local app_config cannot change the test', async () => {
      await withMemoryDatabase(async (scratch) => {
        await setBackupSettings(scratch, { enabled: false }, silent);
        const counted = countingDb(scratch);
        const calls: SpawnRequest[] = [];
        const spawn: Spawner = async (request) => {
          calls.push(request);
          return { exitCode: 1, signal: null, stderr: '' };
        };
        const started: unknown[] = [];
        const timers: BackupTimers = { setInterval: () => void started.push(1), clearInterval: () => {} };
        const selectsBefore = counted.selects();

        await start({ backup: { dialect: 'pg', db: counted.db, outDir: tmpdir(), spawn, timers, databaseUrl: FAKE_URL, logger: silent } });
        await stopRunning();

        // The scratch database was read (this fails if the override is dropped, whatever the
        // service's own database says), and what it said, backups off, is what the schedule did
        expect(counted.selects()).toBeGreaterThan(selectsBefore);
        expect(started).toEqual([]);
        expect(calls).toEqual([]);
      });
    });

    test('a schedule that cannot start is logged by name and does not stop the service', async () => {
      await withMemoryDatabase(async (scratch) => {
        const { log: logger, records } = captureLog();
        const timers: BackupTimers = {
          setInterval: () => {
            throw new TypeError('timer refused for postgres://u:leaky@h/d');
          },
          clearInterval: () => {},
        };

        const { chassisServers } = await start({ backup: { db: scratch, outDir: tmpdir(), timers, logger } });

        expect(chassisServers[0]?.listening).toBe(true);
        const failure = () => records.find((record) => record.step === 'startBackups');
        await until(() => failure() !== undefined);
        expect(failure()).toMatchObject({ domain: 'Server', scope: 'start', step: 'startBackups', reason: 'TypeError', level: 'error' });
        expect(JSON.stringify(records)).not.toContain('leaky');
      });
    });
  });
});

describe('APP_PATHS', () => {
  test('are the sign-in, the app\'s landing page and the tokens page, beside the root', () => {
    expect(APP_PATHS).toEqual(['/', '/login', APP.landing.path, '/tokens']);
  });
});
