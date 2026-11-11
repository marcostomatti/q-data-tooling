import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { mountRoutes } from '../../src/routes/http.ts';
import { captureLog } from '../support/capture-log.ts';
import { untouchableDb } from '../support/tool-harness.ts';

import { startTestServer, type TestServer } from './harness.ts';

/** The shape of a UUID, which is what a request with no `x-request-id` is traced by. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const { log, records } = captureLog();
let recordsBefore = 0;
let server: TestServer;

beforeAll(async () => {
  server = await startTestServer((app) => mountRoutes(app, untouchableDb(), log));
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  recordsBefore = records.length;
});

/** The flow's crumb among the lines written since the current test began. */
const flowLines = (): readonly Record<string, unknown>[] => records.slice(recordsBefore).filter((record) => record.step === 'read');

describe('GET /api/info trace id', () => {
  test('carries a supplied x-request-id on the flow line and the response header', async () => {
    const response = await fetch(`${server.origin}/api/info`, { headers: { 'x-request-id': 'req-abc.1:2' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-abc.1:2');
    const lines = flowLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ traceId: 'req-abc.1:2', domain: 'Info', scope: 'get', step: 'read' });
  });

  test('generates a UUID trace id when no x-request-id is sent, on both line and header', async () => {
    const response = await fetch(`${server.origin}/api/info`);

    expect(response.status).toBe(200);
    const header = response.headers.get('x-request-id');
    expect(header).toMatch(UUID);
    const lines = flowLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ traceId: header, domain: 'Info', scope: 'get', step: 'read' });
  });
});
