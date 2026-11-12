import type { SpawnRequest, Spawner } from '../../../src/backup/pg-dump.ts';
import type { BackupTimers } from '../../../src/backup/schedule.ts';
import type { Log } from '../../../src/logging.ts';
import type { TestDatabase } from '../../support/test-db.ts';
import type { ServiceHandle } from '@open-tomato/service-express';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import { closeDb, getDb, type ActiveClient } from '../../../src/data/active.ts';
import { setBackupSettings } from '../../../src/data/repositories/config.ts';
import { startService } from '../../../src/http/server.ts';
import { countingDb } from '../../backup/db-proxies.ts';
import { answers, listenedPorts, restoreVariable as restore, TEST_KEY, TEST_SEC_USER_AGENT } from '../../http/start-probes.ts';
import { captureLog } from '../../support/capture-log.ts';
import { startInTest } from '../../support/service-process.ts';
import { openTestDatabase } from '../../support/test-db.ts';

// The starts refused before anything opens, and the checks that start nothing, need no database
// and are tested in tests/http/server.test.ts.

type Running = { readonly handle: ServiceHandle };

const savedEnv = {
  apiKey: process.env.API_KEY,
  authMode: process.env.AUTH_MODE,
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  secUserAgent: process.env.SEC_USER_AGENT,
};
let running: Running | undefined;
/** The scratch database every start in this file runs on, emptied before each test. */
let database: TestDatabase;

/**
 * Starts the service in this process, on the scratch database `beforeEach` points `DATABASE_URL`
 * at. A test sees it listen through {@link answers} on the handle's `url`; the chassis logs each
 * request on the service logger, which `LOG_LEVEL=silent` quiets. The routes are tested without
 * the service, in `tests/http/routes.test.ts` and `tests/http/handler.test.ts`.
 */
async function start(opts?: Parameters<typeof startService>[0]): Promise<Running> {
  running = { handle: await startInTest(opts) };
  return running;
}

/** A port nothing listens on now: the OS picks one, and the probe closes it again. */
async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('the probe reports no port');
  return address.port;
}

async function stopRunning(): Promise<void> {
  const current = running;
  running = undefined;
  if (!current) return;
  await current.handle.stop();
}

/** Reads `select 1` through `db`, from a subquery, so it needs no table. */
async function selectOne(db: ActiveClient): Promise<unknown> {
  return db.select({ one: sql<number>`1` }).from(sql`(select 1) as probe`);
}

// The chassis's service logger reads LOG_LEVEL when it is made, at each start. Nothing here
// reads what it writes.
beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  database = await openTestDatabase();
});

afterAll(async () => {
  restore('LOG_LEVEL', savedEnv.logLevel);
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  process.env.API_KEY = TEST_KEY;
  // Set here and not left to `.env`, which Bun loads into the tests: without it no start succeeds.
  process.env.SEC_USER_AGENT = TEST_SEC_USER_AGENT;
  // No login mode, whatever `.env` sets: Bun loads `.env` into the tests, and `bun run
  // set-password` writes `AUTH_MODE=password` there, which would let the service start without
  // an API_KEY.
  delete process.env.AUTH_MODE;
  // The scratch database, so no test opens or writes the database `.env.test` names.
  process.env.DATABASE_URL = database.url;
  await closeDb();
});

afterEach(async () => {
  await stopRunning();
  await closeDb();
  restore('API_KEY', savedEnv.apiKey);
  restore('AUTH_MODE', savedEnv.authMode);
  restore('DATABASE_URL', savedEnv.databaseUrl);
  restore('SEC_USER_AGENT', savedEnv.secUserAgent);
});

describe('startService', () => {
  test('starts with the SEC_USER_AGENT beforeEach sets (control for the refusals in tests/http/server.test.ts)', async () => {
    const { handle } = await start();

    expect(await answers(handle.url)).toBe(true);
  });

  test('starts on the database DATABASE_URL names', async () => {
    const { handle } = await start();

    expect(await answers(handle.url)).toBe(true);
    expect(await selectOne(getDb())).toEqual([{ one: 1 }]);
    expect(await getDb().select({ name: sql<string>`current_database()` })
      .from(sql`(select 1) as probe`)).toEqual([{ name: database.name }]);
  });

  describe('the port', () => {
    test('with neither a port option nor PORT, asks the OS for a free port under NODE_ENV=test', async () => {
      const saved = process.env.PORT;
      delete process.env.PORT;

      try {
        const ports = await listenedPorts(() => start());

        // The control for the refusals in tests/http/server.test.ts: a start that listens is seen
        // listening
        expect(ports).toEqual([0]);
        expect(await answers(running!.handle.url)).toBe(true);
      } finally {
        restore('PORT', saved);
      }
    });

    test('a port option is bound as given', async () => {
      const port = await freePort();

      const { handle } = await start({ port });

      expect(handle.port).toBe(port);
      expect(await answers(handle.url)).toBe(true);
    });

    test('a PORT is bound as given', async () => {
      const saved = process.env.PORT;
      const port = await freePort();
      process.env.PORT = String(port);

      try {
        const { handle } = await start();

        expect(handle.port).toBe(port);
      } finally {
        restore('PORT', saved);
      }
    });

    /** Holds a port open until `release`, so a start on it finds it taken. */
    async function heldPort(): Promise<{ readonly port: number, release(): Promise<void> }> {
      const holder = createNetServer();
      await new Promise<void>((resolve) => holder.listen(0, resolve));
      const address = holder.address();
      if (address === null || typeof address === 'string') throw new Error('the holder reports no port');
      return { port: address.port, release: () => new Promise<void>((resolve) => holder.close(() => resolve())) };
    }

    test.each([
      ['PORT', (port: number) => ({ env: String(port), opts: {} })],
      ['port', (port: number) => ({ env: undefined, opts: { port } })],
    ] as const)('a taken port under PORT_STRICT=true is refused with a message naming %s, where the port came from', async (key, where) => {
      const saved = { port: process.env.PORT, strict: process.env.PORT_STRICT };
      const held = await heldPort();
      const { env, opts } = where(held.port);
      restore('PORT', env);
      process.env.PORT_STRICT = 'true';

      try {
        await expect(start(opts)).rejects.toThrow(`port ${held.port} is taken; set ${key} to a free port`);
      } finally {
        restore('PORT', saved.port);
        restore('PORT_STRICT', saved.strict);
        await held.release();
      }
    });
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
    const { handle } = await start();
    const db = getDb();
    await selectOne(db);
    expect(await answers(handle.url)).toBe(true);

    await handle.stop();
    running = undefined;

    expect(await answers(handle.url)).toBe(false);
    const afterStop = (async () => selectOne(db))();
    await expect(afterStop).rejects.toThrow();
  });

  describe('the backup schedule', () => {
    const silent: Log = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };
    /**
     * A made-up connection for a stand-in that never connects. The tests that gate the dump pass
     * the `'pg'` dialect and a stand-in for `pg_dump`, so a dump can be held open and no
     * Postgres server is dumped.
     */
    const FAKE_URL = 'postgres://backup_user:s3cret@db.example.test:5433/app_db';
    let backupDir: string | undefined;
    /** The database the schedule is handed, apart from the service's own. */
    let backupDatabase: TestDatabase;

    beforeAll(async () => {
      backupDatabase = await openTestDatabase();
    });

    afterAll(async () => {
      await backupDatabase.close();
    });

    afterEach(async () => {
      if (backupDir) await rm(backupDir, { recursive: true, force: true });
      backupDir = undefined;
    });

    /** Runs `use` on the backup database, emptied first, so each test starts on a fresh one. */
    async function withBackupDatabase(use: (scratch: ActiveClient) => Promise<void>): Promise<void> {
      await backupDatabase.reset();
      await use(backupDatabase.db);
    }

    /** Waits, up to a few seconds, for a condition a background task will bring about. */
    async function until(condition: () => boolean): Promise<void> {
      const deadline = Date.now() + 5_000;
      while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(condition()).toBe(true);
    }

    test('does not hold the service back while a due dump runs, and stop() clears its timer', async () => {
      await withBackupDatabase(async (scratch) => {
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
          const { handle } = await start({ backup: { dialect: 'pg', db: scratch, outDir: backupDir, spawn, timers, databaseUrl: FAKE_URL, logger: silent } });
          await until(() => calls.length === 1);

          // Assert: the dump is still in flight and the service already listens
          expect(await answers(handle.url)).toBe(true);
          expect(cleared).toEqual([]);
        } finally {
          release();
        }
        await stopRunning();
        expect(cleared).toEqual(['timer']);
      });
    });

    test('reads its settings from the database it is given, so a local app_config cannot change the test', async () => {
      await withBackupDatabase(async (scratch) => {
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
      await withBackupDatabase(async (scratch) => {
        const { log: logger, records } = captureLog();
        const timers: BackupTimers = {
          setInterval: () => {
            throw new TypeError('timer refused for postgres://u:leaky@h/d');
          },
          clearInterval: () => {},
        };

        const { handle } = await start({ backup: { db: scratch, outDir: tmpdir(), timers, logger } });

        expect(await answers(handle.url)).toBe(true);
        const failure = () => records.find((record) => record.step === 'startBackups');
        await until(() => failure() !== undefined);
        expect(failure()).toMatchObject({ domain: 'Server', scope: 'start', step: 'startBackups', reason: 'TypeError', level: 'error' });
        expect(JSON.stringify(records)).not.toContain('leaky');
      });
    });
  });
});

describe('APP_PATHS', () => {
  test('a reload on the filings page, with or without a company, is answered with the app', async () => {
    const webDist = await mkdtemp(join(tmpdir(), 'web-bundle-'));
    try {
      await writeFile(join(webDist, 'index.html'), '<!doctype html><title>app shell</title>');
      const { handle } = await start({ webDist });
      for (const path of ['/filings', '/filings/320193']) {
        const response = await fetch(`${handle.url}${path}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('app shell');
      }
    } finally {
      await rm(webDist, { recursive: true, force: true });
    }
  });
});
