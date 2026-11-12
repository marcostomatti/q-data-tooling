import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DOMAIN } from '../../../src/routes/filings/contract.ts';
import { filingListRoute, filingRoutes, filingSummaryRoute } from '../../../src/routes/filings/http.ts';
import { filingListTool, filingSummaryTool } from '../../../src/routes/filings/tool.ts';
import { mountRoutes, ROUTES } from '../../../src/routes/http.ts';
import { startTestServer, type TestServer } from '../../http/harness.ts';
import { captureLog } from '../../support/capture-log.ts';
import { selectOnlyWithSql } from '../companies/seeded-db.ts';
import { APPLE_10K, FIXED_FILINGS } from '../fixtures.ts';

import { APPLE_CIK, openSeededFilingsDb } from './seeded-db.ts';

/** The base log the routes are mounted with; each request's flow writes its line here. */
const { log, records } = captureLog();

let db: SqliteTestClient;
let server: TestServer;

beforeAll(async () => {
  db = await openSeededFilingsDb();
  server = await startTestServer((app) => mountRoutes(app, db, log));
});

afterAll(async () => {
  await server.close();
  db.$client.close();
});

describe('the filings routes in the table', () => {
  test('are listed in ROUTES on their tools\' own schema objects', () => {
    expect(ROUTES).toEqual(expect.arrayContaining([...filingRoutes]));
    expect(filingListRoute).toMatchObject({ method: 'get', path: '/companies/:ticker/filings', tools: ['filing_list'] });
    expect(filingSummaryRoute).toMatchObject({ method: 'get', path: '/filings/summary', tools: ['filing_summary'] });
    expect(filingListRoute.schemas[0]).toBe(filingListTool.input);
    expect(filingSummaryRoute.schemas[0]).toBe(filingSummaryTool.input);
  });

  test('each carries a summary for the OpenAPI document', () => {
    for (const spec of filingRoutes) expect(spec.docs.summary.trim().length).toBeGreaterThan(0);
  });
});

describe('GET /api/companies/:ticker/filings', () => {
  test('answers the stored company and the first page of its stored filings, reading a lower-case ticker as upper case', async () => {
    const outcome = await server.request('GET', '/api/companies/aapl/filings');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({
      success: true,
      data: {
        company: { cik: APPLE_CIK, cik10: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', selected: true },
        filings: { items: [...FIXED_FILINGS], page: 1, pageSize: 25, total: FIXED_FILINGS.length },
      },
    });
  });

  test('resolves a secondary ticker to its company, whose stored filings it reads', async () => {
    const outcome = await server.request('GET', '/api/companies/AEMRF/filings');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { company: { cik: 2809, ticker: 'AEM' }, filings: { items: [], total: 0 } } });
  });

  test('answers a page past the last one with no items and the real total', async () => {
    const outcome = await server.request('GET', '/api/companies/AAPL/filings?page=2');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { filings: { items: [], page: 2, total: FIXED_FILINGS.length } } });
  });

  test('reads form from the query string and keeps only that base form', async () => {
    const outcome = await server.request('GET', '/api/companies/AAPL/filings?form=8-K&sort=filingDate');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { filings: { items: [], total: 0 } } });
  });

  test('answers a 404 NotFoundError for a ticker no company trades under', async () => {
    const outcome = await server.request('GET', '/api/companies/NOPE/filings');
    expect(outcome.status).toBe(404);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'NotFoundError' } });
  });

  test('reads form=other from the query string, the bucket of every form it does not name', async () => {
    const outcome = await server.request('GET', '/api/companies/AAPL/filings?form=other');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { filings: { items: [], total: 0 } } });
  });

  test('refuses a form outside the buckets, such as S-1, with a 400 led by its path', async () => {
    const outcome = await server.request('GET', '/api/companies/AAPL/filings?form=S-1');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringMatching(/^form: /) } });
  });

  test('refuses a stray query parameter, naming it', async () => {
    const outcome = await server.request('GET', '/api/companies/AAPL/filings?verbose=1');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringContaining('Unrecognized key: "verbose"') } });
  });

  test('writes the flow\'s line under the Filings domain, which http.ts binds on the request\'s log', async () => {
    const before = records.length;

    await server.request('GET', '/api/companies/AAPL/filings');

    const written = records.slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ domain: DOMAIN, scope: 'list', step: 'read', level: 'debug' });
  });
});

describe('GET /api/filings/summary', () => {
  test('answers the first page of the stored selected companies\' summaries in the success envelope', async () => {
    const outcome = await server.request('GET', '/api/filings/summary');

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      success: true,
      data: {
        items: [{
          cik: APPLE_CIK,
          ticker: 'AAPL',
          name: 'Apple Inc.',
          counts: { '10-K': 1, '10-Q': 0, '8-K': 0, '6-K': 0, '4': 0, '144': 0, other: 0, total: 1 },
          lastFiled: { '10-K': '2026-11-03', '10-Q': null, '8-K': null, '6-K': null, '4': null, '144': null, other: null },
          latest10K: { filingDate: '2026-11-03', links: APPLE_10K.links },
          filingsSyncedAt: null,
        }],
        page: 1,
        pageSize: 25,
        total: 1,
      },
    });
  });

  test('reads the selected flags as they are stored when it answers', async () => {
    selectOnlyWithSql(db, [APPLE_CIK, 104169]);
    try {
      const outcome = await server.request('GET', '/api/filings/summary?pageSize=1&page=2');
      expect(outcome.status).toBe(200);
      expect(outcome.body).toMatchObject({ success: true, data: { items: [{ ticker: 'WMT', latest10K: null }], total: 2 } });
    } finally {
      selectOnlyWithSql(db, [APPLE_CIK]);
    }
  });

  test('refuses a bad field with a 400 led by its path', async () => {
    const outcome = await server.request('GET', '/api/filings/summary?page=0');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringMatching(/^page: /) } });
  });

  test('refuses a stray query parameter, naming it', async () => {
    const outcome = await server.request('GET', '/api/filings/summary?ticker=AAPL');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringContaining('Unrecognized key: "ticker"') } });
  });

  test('writes the flow\'s line under the Filings domain', async () => {
    const before = records.length;

    await server.request('GET', '/api/filings/summary');

    const written = records.slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ domain: DOMAIN, scope: 'summary', step: 'read', level: 'debug' });
  });
});
