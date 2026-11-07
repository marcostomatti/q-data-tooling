import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Router } from 'express';
import { z } from 'zod';

import { webRoute } from '../../src/http/route.ts';
import { mountRoutes, ROUTES } from '../../src/routes/http.ts';
import { ALL_TOOLS } from '../../src/routes/tools.ts';
import { captureLog } from '../support/capture-log.ts';
import { untouchableDb } from '../support/tool-harness.ts';

import { startTestServer, type TestServer } from './harness.ts';

let probe: TestServer;

beforeAll(async () => {
  // The probe's database fails the test if it is touched: a probe the schema refuses never reaches it.
  probe = await startTestServer((app) => mountRoutes(app, untouchableDb(), captureLog().log));
});

afterAll(async () => {
  await probe.close();
});

const concrete = (path: string): string => path.replace(/:[A-Za-z]+/g, '1');

const toolNamed = (name: string): (typeof ALL_TOOLS)[number] => {
  const found = ALL_TOOLS.find((tool) => tool.name === name);
  if (!found) throw new Error(`no tool is named ${name}`);
  return found;
};

describe('the route table', () => {
  test('every route is reachable: none answers 404 for its own path, and a refused request never reaches the database', async () => {
    for (const spec of ROUTES) {
      const method = spec.method.toUpperCase();
      const asked = method === 'GET'
        ? `${concrete(spec.path)}?__probe=1`
        : concrete(spec.path);

      const outcome = await probe.request(method, `/api${asked}`, method === 'GET'
        ? undefined
        : { __probe: 1 });

      // A route Express does not know answers an HTML 404; one that is mounted answers the JSON envelope.
      expect({ route: `${method} ${spec.path}`, status: outcome.status }).toEqual({ route: `${method} ${spec.path}`, status: 400 });
      expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError' } });
    }
  });

  test('every route shares its tool schema by identity, not by equality', () => {
    for (const spec of ROUTES) {
      expect(spec.schemas).toHaveLength(spec.tools.length);
      for (const [index, toolName] of spec.tools.entries()) {
        expect(spec.schemas[index]).toBe(toolNamed(toolName).input);
      }
    }
  });

  test('no two routes share a method and path', () => {
    const keys = ROUTES.map((spec) => `${spec.method} ${spec.path}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  test('no tool is served by more than one route', () => {
    const served = ROUTES.flatMap((spec) => spec.tools);
    expect(served.length).toBe(new Set(served).size);
  });
});

describe('the delete method', () => {
  test('a webRoute on delete answers a DELETE, and a GET on the same path is a 404', async () => {
    const removed = webRoute('delete', '/probe-items/:itemId', z.strictObject({ itemId: z.string() }), async (args) => ({ removed: args.itemId }));
    // Mounted the way mountRoutes mounts each spec, by indexing the router with the spec's method.
    const server = await startTestServer((app) => {
      const api = Router();
      api[removed.method](removed.path, removed.handler(untouchableDb(), captureLog().log));
      app.use('/api', api);
    });
    try {
      const deleted = await server.request('DELETE', '/api/probe-items/7');
      const read = await server.request('GET', '/api/probe-items/7');

      expect(deleted.status).toBe(200);
      expect(JSON.stringify(deleted.body)).toContain('"removed":"7"');
      expect(read.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
