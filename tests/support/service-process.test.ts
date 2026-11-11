import type { ServiceProcess } from './service-process.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';

import { APP } from '../../src/app-config.ts';
import { GENERATED_KEY_LENGTH } from '../../src/auth/api-key.ts';
import { hashPassword } from '../../src/auth/password-hash.ts';
import { getDb } from '../../src/data/active.ts';

import { startServiceProcess } from './service-process.ts';

/** Made up for this file; it matches nothing real. As long as a generated key, so no short-key warning. */
const TEST_KEY = 'service-process-test-key-'.padEnd(GENERATED_KEY_LENGTH, 'k');

/** The variables these tests set or check, saved before each test and put back after it. */
const WATCHED = ['API_KEY', 'AUTH_MODE', 'AUTH_PASSWORD_HASH', 'DATABASE_URL', 'LOG_LEVEL'] as const;

let saved: ReadonlyArray<readonly [string, string | undefined]> = [];
let running: ServiceProcess | undefined;

function setVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** The watched variables as they stand now. */
function snapshot(): Record<string, string | undefined> {
  return Object.fromEntries(WATCHED.map((name) => [name, process.env[name]]));
}

async function start(env: Parameters<typeof startServiceProcess>[0]): Promise<ServiceProcess> {
  running = await startServiceProcess(env);
  return running;
}

beforeEach(() => {
  saved = WATCHED.map((name) => [name, process.env[name]] as const);
  // A known starting point, unlike any value a run sets, so a restore that did nothing shows.
  process.env.API_KEY = 'the-key-before-the-run';
  process.env.DATABASE_URL = 'file:./never-opened-by-these-tests.db';
  delete process.env.AUTH_MODE;
  delete process.env.AUTH_PASSWORD_HASH;
  delete process.env.LOG_LEVEL;
});

afterEach(async () => {
  await running?.stop();
  running = undefined;
  for (const [name, value] of saved) setVariable(name, value);
});

describe('startServiceProcess', () => {
  test('GET /api/info on the returned origin reports APP.id', async () => {
    const service = await start({ API_KEY: TEST_KEY });

    const response = await fetch(`${service.origin}/api/info`, { headers: { authorization: `Bearer ${TEST_KEY}` } });

    expect(service.origin).toMatch(/^http:\/\/localhost:\d+$/);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { id: APP.id, dialect: 'sqlite' } });
  });

  test('the origin is the service with its credential check, so a request without the key is refused', async () => {
    const service = await start({ API_KEY: TEST_KEY });

    const response = await fetch(`${service.origin}/api/info`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { name: 'Unauthorized' } });
  });

  test('sets the caller\'s env for the run, and stop() restores every variable it set', async () => {
    const before = snapshot();
    const hash = await hashPassword('a password for this test only');

    const service = await start({ API_KEY: undefined, AUTH_MODE: 'password', AUTH_PASSWORD_HASH: hash });

    // The control: the run did change the environment, so the check after stop() can fail.
    expect(snapshot()).toEqual({
      API_KEY: undefined,
      AUTH_MODE: 'password',
      AUTH_PASSWORD_HASH: hash,
      DATABASE_URL: ':memory:',
      LOG_LEVEL: 'silent',
    });

    await service.stop();

    expect(snapshot()).toEqual(before);
  });

  test('runs on a migrated :memory: database, and stop() closes it and the server', async () => {
    const service = await start({ API_KEY: TEST_KEY });
    const db = getDb();
    expect(await db.select({ count: sql<number>`count(*)` }).from(sql`app_config`)).toEqual([{ count: 0 }]);

    await service.stop();

    const afterStop = (async () => db.select({ one: sql<number>`1` }).from(sql`(select 1) as probe`))();
    await expect(afterStop).rejects.toThrow();
    await expect(fetch(`${service.origin}/api/info`)).rejects.toThrow();
  });

  test('a second stop() does nothing more', async () => {
    const service = await start({ API_KEY: TEST_KEY });
    const before = snapshot();
    await service.stop();
    const after = snapshot();

    await service.stop();

    expect(after).not.toEqual(before);
    expect(snapshot()).toEqual(after);
  });

  test('a start the service refuses restores the env and leaves the next start free to run', async () => {
    const before = snapshot();

    await expect(startServiceProcess({ AUTH_MODE: 'not-a-mode' })).rejects.toThrow(/AUTH_MODE/);

    expect(snapshot()).toEqual(before);
    const service = await start({ API_KEY: TEST_KEY });
    expect((await fetch(`${service.origin}/api/info`)).status).toBe(401);
  });

  test('refuses a second run while one is live, and a DATABASE_URL from the caller', async () => {
    await start({ API_KEY: TEST_KEY });

    await expect(startServiceProcess({ API_KEY: TEST_KEY })).rejects.toThrow(/already running/);
    await expect(startServiceProcess({ DATABASE_URL: 'file:./x.db' })).rejects.toThrow(/DATABASE_URL/);
    expect(process.env.DATABASE_URL).toBe(':memory:');
  });
});
