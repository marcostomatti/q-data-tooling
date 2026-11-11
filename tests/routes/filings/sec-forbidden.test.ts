/**
 * A 403 from SEC, through the real SEC client over a stub `fetch`, mounted on the routes over a
 * seeded database. A company never synced has no rows to serve, so the request answers 502; a
 * company synced before is stale, and its stored rows are served with the `filingsSyncedAt`
 * they were stored at. Every test first asserts that the stub received the request, so a run
 * that went anywhere else fails. No test reaches sec.gov.
 *
 * @module
 */

import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { afterEach, describe, expect, test } from 'bun:test';

import { updateCompanyHeader } from '../../../src/data/repositories/companies.ts';
import { mountRoutes } from '../../../src/routes/http.ts';
import { createSecClient } from '../../../src/sec/client.ts';
import { startTestServer, type TestServer } from '../../http/harness.ts';
import { captureLog } from '../../support/capture-log.ts';
import { FIXED_FILINGS } from '../fixtures.ts';

import { APPLE_CIK, openSeededFilingsDb } from './seeded-db.ts';

const HTTP_BAD_GATEWAY = 502;
const HTTP_OK = 200;

/** A synced-at long past the 24-hour TTL, so Apple is stale whatever the clock reads. */
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');

/** The request URL of each stub call. */
interface StubFetch {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly requested: string[]
}

function forbiddenFetch(): StubFetch {
  const requested: string[] = [];
  return {
    requested,
    async fetch(url) {
      requested.push(url);
      return new Response('Forbidden', { status: 403 });
    },
  };
}

let db: SqliteTestClient | undefined;
let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  db?.$client.close();
  server = undefined;
  db = undefined;
});

async function mountWith(stub: StubFetch): Promise<TestServer> {
  db = await openSeededFilingsDb();
  const opened = db;
  const sec = createSecClient({ fetch: stub.fetch, userAgent: 'stub-agent stub@example.invalid', sleep: async () => {} });
  server = await startTestServer((app) => mountRoutes(app, opened, captureLog().log, 'none', sec));
  return server;
}

describe('a 403 from SEC on GET /api/companies/:ticker/filings', () => {
  test('answers 502 when no rows are stored for the company', async () => {
    const stub = forbiddenFetch();
    const api = await mountWith(stub);

    const outcome = await api.request('GET', '/api/companies/WMT/filings');

    expect(stub.requested.length).toBeGreaterThan(0);
    expect(stub.requested).toEqual(['https://data.sec.gov/submissions/CIK0000104169.json']);
    expect(outcome.status).toBe(HTTP_BAD_GATEWAY);
    expect(outcome.body).toMatchObject({ success: false });
  });

  test('serves the stale stored rows with their filingsSyncedAt', async () => {
    const stub = forbiddenFetch();
    const api = await mountWith(stub);
    const opened = db as SqliteTestClient;
    await updateCompanyHeader(opened, APPLE_CIK, { exchanges: [], sic: null, sicDescription: null, category: null, fiscalYearEnd: null, syncedAt: LONG_AGO });

    const outcome = await api.request('GET', '/api/companies/AAPL/filings');

    expect(stub.requested).toEqual(['https://data.sec.gov/submissions/CIK0000320193.json']);
    expect(outcome.status).toBe(HTTP_OK);
    expect(outcome.body).toMatchObject({
      success: true,
      data: {
        company: { ticker: 'AAPL', filingsSyncedAt: LONG_AGO.toISOString() },
        filings: { items: [...FIXED_FILINGS], total: FIXED_FILINGS.length },
      },
    });
  });
});
