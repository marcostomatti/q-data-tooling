/**
 * The real service, started in the test process: `startService` from `src/http/server.ts`, on a
 * scratch Postgres database of its own (`openTestDatabase` from `test-db.ts`), with an environment
 * the caller names, listening on an ephemeral port a test reaches over HTTP.
 *
 * `bun test` runs every test file in one process, so the environment and the active database
 * are shared by all of them. {@link startServiceProcess} saves every variable it sets and
 * `stop()` puts each one back, closes the active database and drops the scratch one, so nothing
 * outlives the test.
 *
 * @module
 */

import type { TestDatabase } from './test-db.ts';
import type { StartOptions } from '../../src/http/server.ts';
import type { ServiceHandle } from '@open-tomato/service-express';

import { closeDb } from '../../src/data/active.ts';
import { startService } from '../../src/http/server.ts';

import { openTestDatabase } from './test-db.ts';

/**
 * Runs `startService` in a test. Under `NODE_ENV=test`, with neither a port option nor `PORT`,
 * the chassis binds a port the OS picks, and the handle's `port` and `url` name it.
 *
 * @param opts - Passed to `startService` as they are.
 * @throws {Error} when `NODE_ENV` is not `test`, where the chassis would bind a fixed port.
 */
export async function startInTest(opts?: StartOptions): Promise<ServiceHandle> {
  if (process.env.NODE_ENV !== 'test') throw new Error('starting the service in a test needs NODE_ENV=test');
  return startService(opts);
}

/**
 * The variables to set for one run, by name. `undefined` unsets a variable for the run.
 * `DATABASE_URL` is not among them: the run is always on its own scratch database.
 */
export type ServiceEnv = Readonly<Record<string, string | undefined>>;

/** A running service and the means to reach it and to stop it. */
export interface ServiceProcess {
  /** Where the service listens, as `http://localhost:<port>`, with no trailing slash. */
  readonly origin: string
  /** What `startService` returned. Stop through {@link ServiceProcess.stop}, which also restores the environment. */
  readonly handle: ServiceHandle
  /** The scratch database the service runs on, migrated and empty at the start. */
  readonly database: TestDatabase
  /**
   * Stops the service, closes the active database, drops the scratch one and restores every
   * variable the start set. A second call waits on the first and does nothing more.
   */
  stop(): Promise<void>
}

/**
 * Set unless the caller names its own. The service's loggers, the chassis's request logger among
 * them, read `LOG_LEVEL` when they are made, and a test reads none of what they write. `PORT` and
 * `PORT_STRICT` are unset so a developer's `.env`, which `bun test` loads, cannot move the run off
 * the port the OS picks or make a taken port an error. `SEC_USER_AGENT` is a made-up value at a
 * reserved domain, because the service does not start without one, and a run must not depend on
 * a developer's `.env` holding it; no test reaches SEC with it.
 */
const DEFAULT_ENV: ServiceEnv = {
  LOG_LEVEL: 'silent',
  PORT: undefined,
  PORT_STRICT: undefined,
  SEC_USER_AGENT: 'q-data-tooling tests tests@example.com',
};

/** Whether a run is live: the active database is one per process, so two runs would share it. */
let running = false;

type SavedEnv = ReadonlyArray<readonly [string, string | undefined]>;

/** Sets each variable of `env` (`undefined` unsets it) and returns what each held before. */
function applyEnv(env: ServiceEnv): SavedEnv {
  const saved = Object.keys(env).map((name) => [name, process.env[name]] as const);
  for (const [name, value] of Object.entries(env)) setVariable(name, value);
  return saved;
}

function restoreEnv(saved: SavedEnv): void {
  for (const [name, value] of saved) setVariable(name, value);
}

function setVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * Starts the real service on a fresh, migrated scratch database, with `env` set on `process.env`
 * for the run and `DATABASE_URL` pointed at the scratch database.
 *
 * A start that fails restores the environment, closes the active database and drops the scratch
 * one before it rethrows, so the caller has nothing to clean up.
 *
 * @param env - The variables to set for the run, on top of `LOG_LEVEL=silent` and a test
 *   `SEC_USER_AGENT`.
 * @param opts - Passed to `startService` as they are.
 * @returns The origin the service listens on and its `stop()`.
 * @throws {Error} when `env` names `DATABASE_URL`, or another run has not been stopped.
 */
export async function startServiceProcess(env: ServiceEnv = {}, opts?: StartOptions): Promise<ServiceProcess> {
  if (Object.hasOwn(env, 'DATABASE_URL')) throw new Error('the service process always runs on its own scratch database; leave DATABASE_URL out');
  if (running) throw new Error('a service process is already running; stop it before starting another');
  running = true;
  let database: TestDatabase;
  try {
    // Read before the run's env is set: the scratch database is made on the `.env.test` server.
    database = await openTestDatabase();
  } catch (error: unknown) {
    running = false;
    throw error;
  }
  const saved = applyEnv({ ...DEFAULT_ENV, ...env, DATABASE_URL: database.url });

  const release = async (): Promise<void> => {
    try {
      try {
        await closeDb();
      } finally {
        await database.close();
      }
    } finally {
      restoreEnv(saved);
      running = false;
    }
  };

  let handle: ServiceHandle;
  try {
    // Whatever was open before read another DATABASE_URL: closing it makes the next open read ours.
    await closeDb();
    handle = await startInTest(opts);
  } catch (error: unknown) {
    await release();
    throw error;
  }

  let stopping: Promise<void> | undefined;
  const finish = async (): Promise<void> => {
    try {
      await handle.stop();
    } finally {
      await release();
    }
  };
  return {
    origin: handle.url,
    handle,
    database,
    stop: () => (stopping ??= finish()),
  };
}
