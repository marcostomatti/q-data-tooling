import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DOMAIN } from '../../../src/routes/companies/contract.ts';
import { companyListRoute, companyRoutes, companyUpdateRoute } from '../../../src/routes/companies/http.ts';
import { companyListTool, companyUpdateTool } from '../../../src/routes/companies/tool.ts';
import { mountRoutes, ROUTES } from '../../../src/routes/http.ts';
import { startTestServer, type TestServer } from '../../http/harness.ts';
import { captureLog } from '../../support/capture-log.ts';

import { openSeededCompaniesDb, SEEDED_TICKERS_BY_NAME, selectOnlyWithSql, storedSelected } from './seeded-db.ts';

/** The base log the routes are mounted with; each request's flow writes its line here. */
const { log, records } = captureLog();

let db: SqliteTestClient;
let server: TestServer;

beforeAll(async () => {
  db = await openSeededCompaniesDb();
  server = await startTestServer((app) => mountRoutes(app, db, log));
});

afterAll(async () => {
  await server.close();
  db.$client.close();
});

/** The tickers of the companies a list answer holds, in its order. */
function tickersOf(body: unknown): string[] {
  return (body as { data: { items: { ticker: string }[] } }).data.items.map((company) => company.ticker);
}

describe('the companies routes in the table', () => {
  test('are listed in ROUTES on their tools\' own schema objects', () => {
    expect(ROUTES).toEqual(expect.arrayContaining([...companyRoutes]));
    expect(companyListRoute).toMatchObject({ method: 'get', path: '/companies', tools: ['company_list'] });
    expect(companyUpdateRoute).toMatchObject({ method: 'patch', path: '/companies/:ticker', tools: ['company_update'] });
    expect(companyListRoute.schemas[0]).toBe(companyListTool.input);
    expect(companyUpdateRoute.schemas[0]).toBe(companyUpdateTool.input);
  });

  test('each carries a summary for the OpenAPI document', () => {
    for (const spec of companyRoutes) expect(spec.docs.summary.trim().length).toBeGreaterThan(0);
  });
});

describe('GET /api/companies', () => {
  test('answers the first page of the stored companies by name in the success envelope', async () => {
    const outcome = await server.request('GET', '/api/companies');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { page: 1, pageSize: 25, total: SEEDED_TICKERS_BY_NAME.length } });
    expect(tickersOf(outcome.body)).toEqual(SEEDED_TICKERS_BY_NAME);
  });

  test('reads q, page and pageSize from the query string and pages on the server', async () => {
    const matched = await server.request('GET', '/api/companies?q=aemr');
    expect(tickersOf(matched.body)).toEqual(['AEM']);
    const second = await server.request('GET', '/api/companies?page=2&pageSize=3');
    expect(second.body).toMatchObject({ data: { page: 2, pageSize: 3, total: SEEDED_TICKERS_BY_NAME.length } });
    expect(tickersOf(second.body)).toEqual(SEEDED_TICKERS_BY_NAME.slice(3));
  });

  test('reads selected from the query string as a boolean', async () => {
    selectOnlyWithSql(db, [320193]);

    const selected = await server.request('GET', '/api/companies?selected=true');
    const unselected = await server.request('GET', '/api/companies?selected=false');

    expect(tickersOf(selected.body)).toEqual(['AAPL']);
    expect(tickersOf(unselected.body)).toEqual(SEEDED_TICKERS_BY_NAME.filter((ticker) => ticker !== 'AAPL'));
    selectOnlyWithSql(db, []);
  });

  test('refuses a bad field with a 400 led by its path', async () => {
    const outcome = await server.request('GET', '/api/companies?pageSize=101');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringMatching(/^pageSize: /) } });
  });

  test('refuses a stray query parameter, naming it', async () => {
    const outcome = await server.request('GET', '/api/companies?verbose=1');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringContaining('Unrecognized key: "verbose"') } });
  });

  test('writes the flow\'s line under the Companies domain, which http.ts binds on the request\'s log', async () => {
    const before = records.length;

    await server.request('GET', '/api/companies');

    const written = records.slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ domain: DOMAIN, scope: 'list', step: 'read', level: 'debug' });
  });
});

describe('PATCH /api/companies/:ticker', () => {
  test('stores the flag and answers the company, reading a lower-case ticker as upper case', async () => {
    const outcome = await server.request('PATCH', '/api/companies/wmt', { selected: true });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ success: true, data: { cik: 104169, ticker: 'WMT', name: 'Walmart Inc.', selected: true } });
    expect(storedSelected(db, 104169)).toBe(true);
  });

  test('a secondary ticker sets the flag on its company', async () => {
    const outcome = await server.request('PATCH', '/api/companies/AEMRF', { selected: true });
    expect(outcome.body).toMatchObject({ success: true, data: { cik: 2809, ticker: 'AEM', selected: true } });
    expect(storedSelected(db, 2809)).toBe(true);
  });

  test('answers a 404 NotFoundError for a ticker no company trades under', async () => {
    const outcome = await server.request('PATCH', '/api/companies/NOPE', { selected: true });
    expect(outcome.status).toBe(404);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'NotFoundError' } });
  });

  test('refuses a body without selected with a 400 led by its path', async () => {
    const outcome = await server.request('PATCH', '/api/companies/AAPL', {});
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringMatching(/^selected: /) } });
  });

  test('refuses a stray body key, naming it', async () => {
    const outcome = await server.request('PATCH', '/api/companies/AAPL', { selected: true, extra: 1 });
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError', message: expect.stringContaining('Unrecognized key: "extra"') } });
  });

  test('writes the flow\'s line under the Companies domain', async () => {
    const before = records.length;

    await server.request('PATCH', '/api/companies/AAPL', { selected: false });

    const written = records.slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ domain: DOMAIN, scope: 'update', step: 'write', level: 'info' });
  });
});
