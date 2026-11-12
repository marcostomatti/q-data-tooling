/**
 * The sync's TTL, its retention cut and the User-Agent, through the real SEC client over a stub
 * `fetch`, mounted on the routes over a seeded scratch Postgres database, emptied and seeded again
 * before each test. The stub answers a submissions document
 * of Apple and records every call with its headers. Every test first asserts that the stub
 * received the request, except the one that shows a request made none. No test reaches sec.gov.
 *
 * The routes read the wall clock, so the filing dates here are computed from it.
 *
 * @module
 */

import type { Filing } from '../../../../src/entities/filing.ts';
import type { TestDatabase } from '../../../support/test-db.ts';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { insertFilings } from '../../../../src/data/repositories/filings.ts';
import { mountRoutes } from '../../../../src/routes/http.ts';
import { createSecClient, type SecFetch } from '../../../../src/sec/client.ts';
import { readSecUserAgent } from '../../../../src/sec/config.ts';
import { RETENTION_DAYS } from '../../../../src/sec/parse.ts';
import { startTestServer, type TestServer } from '../../../http/harness.ts';
import { submissionsDocument, ROWS, toColumns } from '../../../routes/filings/fake-sync.ts';
import { APPLE_10K } from '../../../routes/fixtures.ts';
import { captureLog } from '../../../support/capture-log.ts';
import { openTestDatabase } from '../../../support/test-db.ts';

import { seedFilings } from './seeded-db.ts';

const HTTP_OK = 200;
const MS_PER_DAY = 86_400_000;
const APPLE_SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK0000320193.json';
const FILINGS_PATH = '/api/companies/AAPL/filings';

/** The value the stub run reads from its made-up environment, as the service reads `SEC_USER_AGENT`. */
const STUB_USER_AGENT = 'stub-ttl-agent stub-ttl@example.invalid';

const STORED_OLD_ACCESSION = '0000320193-00-999001';
const SYNCED_NEW_ACCESSION = '0000320193-00-999002';

/** One stub call: the URL and the User-Agent header it carried. */
interface StubCall {
  readonly url: string
  readonly userAgent: string | null
}

/** The date `days` before the wall clock, as `YYYY-MM-DD`. */
const daysAgo = (days: number): string => new Date(Date.now() - days * MS_PER_DAY).toISOString()
  .slice(0, 10);

/** Apple's submissions document holding one 8-K filed 5 days ago. */
function recentDocument(): Record<string, unknown> {
  const [template] = ROWS;
  if (template === undefined) throw new Error('ROWS is empty');
  const row = { ...template, accessionNumber: SYNCED_NEW_ACCESSION, filingDate: daysAgo(5), form: '8-K' };
  return submissionsDocument(toColumns([row]));
}

let database: TestDatabase;
let server: TestServer | undefined;

beforeAll(async () => {
  database = await openTestDatabase();
});

beforeEach(async () => {
  await database.reset();
  await seedFilings(database);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

afterAll(async () => {
  await database.close();
});

async function mountStub(): Promise<{ api: TestServer, db: TestDatabase['db'], calls: StubCall[] }> {
  const calls: StubCall[] = [];
  const stubFetch: SecFetch = async (url, init) => {
    calls.push({ url, userAgent: new Headers(init.headers).get('User-Agent') });
    return Response.json(recentDocument());
  };
  const userAgent = readSecUserAgent({ SEC_USER_AGENT: STUB_USER_AGENT });
  const sec = createSecClient({ fetch: stubFetch, userAgent, sleep: async () => {} });
  server = await startTestServer((app) => mountRoutes(app, database.db, captureLog().log, 'none', sec));
  return { api: server, db: database.db, calls };
}

/** The accession numbers of the filings the list answered. */
function accessionsOf(body: unknown): string[] {
  const items = (body as { data: { filings: { items: Filing[] } } }).data.filings.items;
  return items.map((filing) => filing.accessionNumber);
}

describe('the sync of GET /api/companies/:ticker/filings against a stub SEC', () => {
  test('a second request within the TTL makes no SEC call', async () => {
    const { api, calls } = await mountStub();

    const first = await api.request('GET', FILINGS_PATH);
    expect(calls.map((call) => call.url)).toEqual([APPLE_SUBMISSIONS_URL]);
    const second = await api.request('GET', FILINGS_PATH);

    expect(first.status).toBe(HTTP_OK);
    expect(second.status).toBe(HTTP_OK);
    expect(calls).toHaveLength(1);
    expect(accessionsOf(second.body)).toContain(SYNCED_NEW_ACCESSION);
    expect(second.body).toMatchObject({ data: { company: { filingsSyncedAt: expect.any(String) } } });
  });

  test('deletes the stored rows older than the 365-day cutoff', async () => {
    const { api, db: opened, calls } = await mountStub();
    const old: Filing = { ...APPLE_10K, accessionNumber: STORED_OLD_ACCESSION, filingDate: daysAgo(RETENTION_DAYS + 35) };
    await insertFilings(opened, [old]);

    const outcome = await api.request('GET', FILINGS_PATH);

    expect(calls).toHaveLength(1);
    expect(outcome.status).toBe(HTTP_OK);
    const accessions = accessionsOf(outcome.body);
    expect(accessions).toContain(SYNCED_NEW_ACCESSION);
    expect(accessions).not.toContain(STORED_OLD_ACCESSION);
  });

  test('the request carries the SEC_USER_AGENT value', async () => {
    const { api, calls } = await mountStub();

    const outcome = await api.request('GET', FILINGS_PATH);

    expect(outcome.status).toBe(HTTP_OK);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ url: APPLE_SUBMISSIONS_URL, userAgent: STUB_USER_AGENT });
  });
});
