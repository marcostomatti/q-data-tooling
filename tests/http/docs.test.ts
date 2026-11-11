import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';

import { requireApiAccess } from '../../src/auth/access.ts';
import { mountRoutes } from '../../src/routes/http.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

/** Made up for this file, and built rather than written out, so no scan reads it as a secret. */
const TEST_KEY = `docs-route-test-key-${'0'.repeat(32)}`;

const AUTHORIZED = { authorization: `Bearer ${TEST_KEY}` };

let db: SqliteTestClient;
let server: Server;
let origin: string;

beforeAll(async () => {
  db = await openMigratedMemoryDb();
  // The same order `startService` mounts them in: the credential check on /api, then the routes.
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', requireApiAccess(db, TEST_KEY));
  mountRoutes(app, db);
  server = await new Promise<Server>((ready) => {
    const listening = app.listen(0, () => ready(listening));
  });
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.$client.close();
});

const get = (path: string, headers: Record<string, string> = AUTHORIZED): Promise<Response> => fetch(`${origin}${path}`, { headers });

describe('the API docs behind the /api credential check', () => {
  test('refuses the document and the docs page to a request without a credential', async () => {
    for (const path of ['/api/openapi.json', '/api/docs', '/api/docs/swagger-ui-bundle.js']) {
      expect({ path, status: (await get(path, {})).status }).toEqual({ path, status: 401 });
    }
  });

  test('answers the OpenAPI document as JSON, holding the info route', async () => {
    const response = await get('/api/openapi.json');
    const document = await response.json() as { openapi: string; paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(document.openapi).toStartWith('3.1');
    expect(Object.keys(document.paths)).toContain('/info');
  });

  test('answers the docs page with no inline script, so the default content security policy runs it', async () => {
    const response = await get('/api/docs');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.map(([, attributes]) => /\bsrc="([^"]+)"/.exec(attributes ?? '')?.[1]))
      .toEqual(['/api/docs/swagger-ui-bundle.js', '/api/docs/init.js']);
    expect(scripts.every(([, , body]) => body?.trim() === '')).toBe(true);
    expect(html).toContain('href="/api/docs/swagger-ui.css"');
  });

  test('serves the Swagger UI bundle and its stylesheet from the installed package', async () => {
    const bundle = await get('/api/docs/swagger-ui-bundle.js');
    const css = await get('/api/docs/swagger-ui.css');

    expect(bundle.status).toBe(200);
    expect(bundle.headers.get('content-type')).toContain('javascript');
    expect((await bundle.text()).length).toBeGreaterThan(100_000);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
  });

  test('points the page at this service\'s document, with the online validator off', async () => {
    const init = await (await get('/api/docs/init.js')).text();

    expect(init).toContain('url: \'/api/openapi.json\'');
    expect(init).toContain('validatorUrl: null');
    expect(init).not.toContain('petstore');
  });

  test('serves only the files it names, never the package\'s own demo page', async () => {
    for (const path of ['/api/docs/index.html', '/api/docs/swagger-initializer.js', '/api/docs/swagger-ui-bundle.js.map']) {
      expect({ path, status: (await get(path)).status }).toEqual({ path, status: 404 });
    }
  });
});
