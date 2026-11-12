import type { ApiApp } from '../../http/api-app.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { startApiApp } from '../../http/api-app.ts';
import { openTestDatabase } from '../../support/test-db.ts';

// The requests that read no database, a valid key and none at all, are tested in
// tests/http/info-auth.test.ts.

/** Made up for this file; it matches nothing real. */
const TEST_KEY = 'info-route-test-key-that-is-long-enough-0123456789';

let database: TestDatabase;
let app: ApiApp;

beforeAll(async () => {
  database = await openTestDatabase();
  app = await startApiApp(database.db, TEST_KEY);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('GET /api/info behind the API key check', () => {
  test('rejects a wrong key, which the check looks up as an API token and does not find', async () => {
    const response = await fetch(`${app.origin}/api/info`, { headers: { authorization: 'Bearer not-the-key' } });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
  });
});
