import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { STUB_COMPANIES } from '../../../src/routes/companies/stub.ts';
import { DOMAIN } from '../../../src/routes/filings/contract.ts';
import { filingListRoute, filingRoutes, filingSummaryRoute } from '../../../src/routes/filings/http.ts';
import { filingStubStore, STUB_FILINGS } from '../../../src/routes/filings/stub.ts';
import { filingListTool, filingSummaryTool } from '../../../src/routes/filings/tool.ts';
import { mountRoutes, ROUTES } from '../../../src/routes/http.ts';
import { startTestServer, type TestServer } from '../../http/harness.ts';
import { captureLog } from '../../support/capture-log.ts';
import { untouchableDb } from '../../support/tool-harness.ts';

/** The base log the routes are mounted with; each request's flow writes its line here. */
const { log, records } = captureLog();

let server: TestServer;

beforeAll(async () => {
  // The stub flows read no table, so a database that fails when touched proves it.
  server = await startTestServer((app) => mountRoutes(app, untouchableDb(), log));
});

afterAll(async () => {
  await server.close();
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
  test('answers the company and the first page of its stub filings, reading a lower-case ticker as upper case', async () => {
    const outcome = await server.request('GET', '/api/companies/aapl/filings');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      success: true,
      data: {
        company: STUB_COMPANIES.find((company) => company.ticker === 'AAPL'),
        filings: { items: [...STUB_FILINGS], page: 1, pageSize: 25, total: STUB_FILINGS.length },
      },
    });
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

  test('refuses a form it does not track with a 400 led by its path', async () => {
    const outcome = await server.request('GET', '/api/companies/AAPL/filings?form=4');
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
  test('answers the first page of the selected stub companies\' summaries in the success envelope', async () => {
    const expected = await filingStubStore.summary({ form: undefined, offset: 0, limit: 25 });

    const outcome = await server.request('GET', '/api/filings/summary');

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ success: true, data: { items: [...expected.items], page: 1, pageSize: 25, total: expected.total } });
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
