import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { APP } from '../../src/app-config.ts';
import { closeDb } from '../../src/data/active.ts';
import { APP_PATHS, backupOptionsFor, startService } from '../../src/http/server.ts';
import { InvalidSecUserAgentError } from '../../src/sec/config.ts';

import { listenedPorts, restoreVariable as restore, TEST_KEY, TEST_SEC_USER_AGENT } from './start-probes.ts';

// Every start here is refused before anything listens, so no test reaches a database. The starts
// that succeed run on a scratch Postgres database, in tests/integration/http/server.test.ts,
// which holds the controls for these refusals.

/**
 * A Postgres server that never answers: the URL is made up and names nothing. A check that ran
 * after the database was opened would surface the database's refusal instead of its own, so the
 * refusals' messages tell the two orders apart.
 */
const UNREACHABLE_DATABASE_URL = 'postgres://nobody:unused@localhost:1/nothing';

const savedEnv = {
  apiKey: process.env.API_KEY,
  authMode: process.env.AUTH_MODE,
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL,
  secUserAgent: process.env.SEC_USER_AGENT,
};

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
  // Set here and not left to `.env`, which Bun loads into the tests: without it no start succeeds.
  process.env.SEC_USER_AGENT = TEST_SEC_USER_AGENT;
  // No login mode, whatever `.env` sets: Bun loads `.env` into the tests, and `bun run
  // set-password` writes `AUTH_MODE=password` there, which would let the service start without
  // an API_KEY and hide the key refusal the tests below assert.
  delete process.env.AUTH_MODE;
  process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;
  await closeDb();
});

afterEach(async () => {
  await closeDb();
  restore('API_KEY', savedEnv.apiKey);
  restore('AUTH_MODE', savedEnv.authMode);
  restore('DATABASE_URL', savedEnv.databaseUrl);
  restore('SEC_USER_AGENT', savedEnv.secUserAgent);
});

describe('startService', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
  ])('with API_KEY %s, refuses to start before the database or any listener is touched', async (_label, value) => {
    restore('API_KEY', value);
    let failure: unknown;

    const ports = await listenedPorts(async () => {
      failure = await startService().catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/API_KEY/);
    expect((failure as Error).message).not.toMatch(/database/i);
    expect(ports).toEqual([]);
  });

  test('the refusal names the fix', async () => {
    restore('API_KEY', undefined);

    const failure = await startService().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('set-api-key');
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['without a contact email', 'q-data-tooling'],
  ])('with SEC_USER_AGENT %s and an API_KEY set, refuses to start before the database or any listener is touched', async (_label, value) => {
    restore('SEC_USER_AGENT', value);
    let failure: unknown;

    const ports = await listenedPorts(async () => {
      failure = await startService().catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(InvalidSecUserAgentError);
    expect((failure as Error).message).toMatch(/SEC_USER_AGENT/);
    expect((failure as Error).message).not.toMatch(/database|API_KEY/i);
    expect(ports).toEqual([]);
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

  test('a DATABASE_URL whose server does not answer stops the start before anything listens', async () => {
    let failure: unknown;

    const ports = await listenedPorts(async () => {
      failure = await startService().catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/DATABASE_URL/);
    expect((failure as Error).message).not.toContain('unused');
    expect(ports).toEqual([]);
  });

  describe('the backup schedule', () => {
    test('is not started under NODE_ENV=test unless a test passes its own', () => {
      const own = { outDir: '/somewhere' };

      expect(backupOptionsFor({ NODE_ENV: 'test' }, undefined)).toBeUndefined();
      expect(backupOptionsFor({ NODE_ENV: 'production' }, undefined)).toEqual({});
      expect(backupOptionsFor({}, undefined)).toEqual({});
      expect(backupOptionsFor({ NODE_ENV: 'test' }, own)).toBe(own);
    });
  });
});

describe('APP_PATHS', () => {
  test('are the sign-in, the app\'s landing page (the summary), the filings page with and without a company, the companies page and the tokens page, beside the root', () => {
    expect(APP.landing.path).toBe('/summary');
    expect(APP_PATHS).toEqual(['/', '/login', APP.landing.path, '/filings', '/filings/:cik', '/companies', '/tokens']);
  });
});
