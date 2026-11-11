import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';

import { requireApiAccess } from '../../src/auth/access.ts';
import { mountRoutes } from '../../src/routes/http.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

/** Made up for this file; it matches nothing real. */
const TEST_KEY = 'info-route-test-key-that-is-long-enough-0123456789';

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

async function get(headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}/api/info`, { headers });
  return { status: response.status, body: await response.json() };
}

describe('GET /api/info behind the API key check', () => {
  test('answers the service info on the sqlite dialect to a valid key', async () => {
    const outcome = await get({ authorization: `Bearer ${TEST_KEY}` });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({
      success: true,
      data: { dialect: 'sqlite', notebook: expect.any(Boolean), id: expect.any(String), version: expect.any(String) },
    });
  });

  test('rejects a request with no key', async () => {
    const outcome = await get({});
    expect(outcome.status).toBe(401);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'Unauthorized' } });
  });

  test('rejects a wrong key', async () => {
    const outcome = await get({ authorization: 'Bearer not-the-key' });
    expect(outcome.status).toBe(401);
    expect(outcome.body).toMatchObject({ success: false });
  });
});
