import type { ApiApp } from './api-app.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { NO_DATABASE, startApiApp } from './api-app.ts';

/** Made up for this file; it matches nothing real. */
const TEST_KEY = 'info-route-test-key-that-is-long-enough-0123456789';

let app: ApiApp;

// No database: the info route reads none, and these requests carry the key or no credential at
// all, so the credential check never looks a token or a session up. A wrong key is looked up as
// an API token, so that refusal is tested on Postgres, in tests/integration/http/info-auth.test.ts.
beforeAll(async () => {
  app = await startApiApp(NO_DATABASE, TEST_KEY);
});

afterAll(async () => {
  await app.close();
});

async function get(headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${app.origin}/api/info`, { headers });
  return { status: response.status, body: await response.json() };
}

describe('GET /api/info behind the API key check', () => {
  test('answers the service info on the pg dialect to a valid key', async () => {
    const outcome = await get({ authorization: `Bearer ${TEST_KEY}` });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({
      success: true,
      data: { dialect: 'pg', notebook: expect.any(Boolean), id: expect.any(String), version: expect.any(String) },
    });
  });

  test('rejects a request with no key', async () => {
    const outcome = await get({});
    expect(outcome.status).toBe(401);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'Unauthorized' } });
  });
});
