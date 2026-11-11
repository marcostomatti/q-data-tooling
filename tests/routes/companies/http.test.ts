import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DOMAIN } from '../../../src/routes/companies/contract.ts';
import { companyListRoute, companyRoutes, companyUpdateRoute } from '../../../src/routes/companies/http.ts';
import { STUB_COMPANIES } from '../../../src/routes/companies/stub.ts';
import { companyListTool, companyUpdateTool } from '../../../src/routes/companies/tool.ts';
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
  test('answers the first page of the stub companies in the success envelope', async () => {
    const outcome = await server.request('GET', '/api/companies');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ success: true, data: { items: [...STUB_COMPANIES], page: 1, pageSize: 25, total: STUB_COMPANIES.length } });
  });

  test('reads selected from the query string as a boolean', async () => {
    const outcome = await server.request('GET', '/api/companies?selected=false');
    expect(outcome.body).toMatchObject({ success: true, data: { items: STUB_COMPANIES.filter((company) => !company.selected) } });
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
  test('answers the company with the flag set, reading a lower-case ticker as upper case', async () => {
    const outcome = await server.request('PATCH', '/api/companies/msft', { selected: true });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ success: true, data: { ...STUB_COMPANIES.find((company) => company.ticker === 'MSFT'), selected: true } });
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
