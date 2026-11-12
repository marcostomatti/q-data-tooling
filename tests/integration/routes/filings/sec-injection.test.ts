/**
 * The SEC client reaches the filings and companies flows through the routes and the tools: the
 * client `mountRoutes` or `registerTools` is handed becomes the flows' `deps.sync`, through
 * `syncSourcesFor`, over the same database the route or tool reads. The file's scratch Postgres
 * database is emptied and seeded again before each test, so no company was synced yet and a sync
 * is due on first read. The
 * client is a recording fake that answers Apple's document; no test reaches sec.gov.
 *
 * Every positive reading has a control on the same database shape: mounted or registered
 * without a client, the same request makes no SEC call and leaves `filingsSyncedAt` null.
 *
 * @module
 */

import type { SecClient } from '../../../../src/sec/client.ts';
import type { TestDatabase } from '../../../support/test-db.ts';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { findCompanyByTicker } from '../../../../src/data/repositories/companies.ts';
import { companyTools } from '../../../../src/routes/companies/tool.ts';
import { syncSourcesFor } from '../../../../src/routes/filings/repository.ts';
import { filingTools } from '../../../../src/routes/filings/tool.ts';
import { mountRoutes } from '../../../../src/routes/http.ts';
import { startTestServer, type TestServer } from '../../../http/harness.ts';
import { submissionsDocument } from '../../../routes/filings/fake-sync.ts';
import { captureLog } from '../../../support/capture-log.ts';
import { openTestDatabase } from '../../../support/test-db.ts';
import { connectTools } from '../../../support/tool-harness.ts';

import { APPLE_CIK, seedFilings } from './seeded-db.ts';

/** Apple's CIK padded to ten digits, as the submissions request takes it. */
const APPLE_CIK10 = '0000320193';

/** Walmart's CIK padded to ten digits; Walmart is seeded and not selected. */
const WALMART_CIK10 = '0000104169';

/** The `sicDescription` of {@link submissionsDocument}, which the seed does not hold. */
const SYNCED_SIC_DESCRIPTION = 'Electronic Computers';

/** A client that answers Apple's document and records the CIK of every request. */
interface RecordingSec {
  readonly client: SecClient
  readonly requested: readonly string[]
}

function recordingSec(): RecordingSec {
  const requested: string[] = [];
  return {
    client: {
      async getSubmissions(cik10) {
        requested.push(cik10);
        return submissionsDocument();
      },
    },
    requested,
  };
}

/** The file's database, seeded again before each test. */
let database: TestDatabase;
/** The server a test mounted, closed after it whatever it asserted. */
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

/** Mounts the routes over the seeded database, with `sec` when given. */
async function mount(sec?: SecClient): Promise<TestServer> {
  server = await startTestServer((app) => mountRoutes(app, database.db, captureLog().log, 'none', sec));
  return server;
}

/** Registers `tools` over the seeded database, with `sec` when given. */
async function connect(tools: Parameters<typeof connectTools>[0], sec?: SecClient): Promise<Awaited<ReturnType<typeof connectTools>>> {
  return connectTools(tools, database.db, captureLog().log, sec);
}

describe('syncSourcesFor', () => {
  test('answers undefined without a client, so the flows never sync', () => {
    expect(syncSourcesFor(database.db, undefined)).toBeUndefined();
  });

  test('hands the client on as it is, with stores over the database it is given', async () => {
    const sec = recordingSec();
    const sources = syncSourcesFor(database.db, sec.client);
    expect(sources?.sec).toBe(sec.client);
    const syncedAt = new Date('2026-11-11T12:00:00.000Z');
    const header = { exchanges: ['Nasdaq'], sic: '3571', sicDescription: SYNCED_SIC_DESCRIPTION, category: null, fiscalYearEnd: '0926', syncedAt };
    await sources?.companies.updateHeader(APPLE_CIK, header);
    expect(await findCompanyByTicker(database.db, 'AAPL')).toMatchObject({ sic: '3571', filingsSyncedAt: syncedAt.toISOString() });
    expect(sources?.now()).toBeInstanceOf(Date);
  });
});

describe('GET /api/companies/:ticker/filings with the SEC client mounted', () => {
  test('syncs a never-synced company once, and a second request within the TTL calls SEC no more', async () => {
    const sec = recordingSec();
    const api = await mount(sec.client);

    const first = await api.request('GET', '/api/companies/AAPL/filings');
    const second = await api.request('GET', '/api/companies/AAPL/filings');

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, data: { company: { ticker: 'AAPL', sicDescription: SYNCED_SIC_DESCRIPTION } } });
    expect(first.body).not.toMatchObject({ data: { company: { filingsSyncedAt: null } } });
    expect(second.status).toBe(200);
    expect(sec.requested).toEqual([APPLE_CIK10]);
  });

  test('control: mounted without a client, the same request reads the stored rows and syncs nothing', async () => {
    const api = await mount();
    const outcome = await api.request('GET', '/api/companies/AAPL/filings');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { company: { ticker: 'AAPL', filingsSyncedAt: null } } });
  });
});

describe('PATCH /api/companies/:ticker with the SEC client mounted', () => {
  test('syncs the company before it answers selected: true', async () => {
    const sec = recordingSec();
    const api = await mount(sec.client);
    const outcome = await api.request('PATCH', '/api/companies/WMT', { selected: true });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { ticker: 'WMT', selected: true, sicDescription: SYNCED_SIC_DESCRIPTION } });
    expect(sec.requested).toEqual([WALMART_CIK10]);
  });

  test('never calls SEC for selected: false', async () => {
    const sec = recordingSec();
    const api = await mount(sec.client);
    const outcome = await api.request('PATCH', '/api/companies/AAPL', { selected: false });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { ticker: 'AAPL', selected: false, filingsSyncedAt: null } });
    expect(sec.requested).toEqual([]);
  });

  test('control: mounted without a client, selected: true sets the flag and syncs nothing', async () => {
    const api = await mount();
    const outcome = await api.request('PATCH', '/api/companies/WMT', { selected: true });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { ticker: 'WMT', selected: true, filingsSyncedAt: null } });
  });
});

describe('the filing_list and company_update tools with the SEC client registered', () => {
  test('filing_list syncs a never-synced company before it answers', async () => {
    const sec = recordingSec();
    const tools = await connect(filingTools, sec.client);
    const outcome = await tools.call('filing_list', { ticker: 'AAPL' });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({ company: { ticker: 'AAPL', sicDescription: SYNCED_SIC_DESCRIPTION } });
    expect(sec.requested).toEqual([APPLE_CIK10]);
  });

  test('company_update syncs the company before it answers selected: true', async () => {
    const sec = recordingSec();
    const tools = await connect(companyTools, sec.client);
    const outcome = await tools.call('company_update', { ticker: 'WMT', selected: true });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({ ticker: 'WMT', selected: true, sicDescription: SYNCED_SIC_DESCRIPTION });
    expect(sec.requested).toEqual([WALMART_CIK10]);
  });

  test('control: registered without a client, filing_list syncs nothing', async () => {
    const tools = await connect(filingTools);
    const outcome = await tools.call('filing_list', { ticker: 'AAPL' });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({ company: { ticker: 'AAPL', filingsSyncedAt: null } });
  });
});
