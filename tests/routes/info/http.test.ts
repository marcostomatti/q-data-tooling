import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DIALECT } from '../../../src/data/active.ts';
import { mountRoutes, ROUTES } from '../../../src/routes/http.ts';
import { DOMAIN } from '../../../src/routes/info/contract.ts';
import { getServiceInfo } from '../../../src/routes/info/get.flow.ts';
import { infoRoute } from '../../../src/routes/info/http.ts';
import { infoTool } from '../../../src/routes/info/tool.ts';
import { startTestServer, type TestServer } from '../../http/harness.ts';
import { captureLog } from '../../support/capture-log.ts';
import { untouchableDb } from '../../support/tool-harness.ts';

/** The base log the routes are mounted with; each request's flow writes its line here. */
const { log, records } = captureLog();

let server: TestServer;

beforeAll(async () => {
  // The route never reads the database, so a database that fails when touched proves it.
  server = await startTestServer((app) => mountRoutes(app, untouchableDb(), log));
});

afterAll(async () => {
  await server.close();
});

describe('GET /api/info', () => {
  test('is listed in ROUTES as the service_info route on the tool\'s own schema object', () => {
    expect(ROUTES).toContain(infoRoute);
    expect(infoRoute).toMatchObject({ method: 'get', path: '/info', tools: ['service_info'] });
    expect(infoRoute.schemas[0]).toBe(infoTool.input);
  });

  test('answers the service info in the success envelope', async () => {
    const outcome = await server.request('GET', '/api/info');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ success: true, data: getServiceInfo({}, { env: process.env, dialect: DIALECT, log: captureLog().log }) });
  });

  test('writes the flow\'s line under the Info domain, which http.ts binds on the request\'s log', async () => {
    const before = records.length;

    await server.request('GET', '/api/info');

    const written = records.slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ domain: DOMAIN, scope: 'get', step: 'read', level: 'debug' });
  });

  test('refuses a query parameter the strict schema does not name', async () => {
    const outcome = await server.request('GET', '/api/info?verbose=1');
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError' } });
  });
});
