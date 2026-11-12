import type { Db } from '../../../src/data/repositories/db.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { main as reset } from '../../../src/auth/reset-credentials.ts';
import { createSession, createToken, isLiveSession, useToken } from '../../../src/auth/store.ts';
import { FAKE_ENV_PATH, fakeEnvIo } from '../../auth/fake-env-io.ts';
import { openTestDatabase } from '../../support/test-db.ts';

// `set-password`, and `reset-credentials` on a database that cannot be reached, need no database
// and are tested in tests/auth/credential-scripts.test.ts.

let database: TestDatabase;
let db: TestDatabase['db'];

beforeAll(async () => {
  database = await openTestDatabase();
  db = database.db;
});

beforeEach(async () => {
  await database.reset();
});

afterAll(async () => {
  await database.close();
});

describe('bun run reset-credentials', () => {
  async function seed(client: Db): Promise<{ session: string; token: string }> {
    return { session: await createSession(client), token: (await createToken(client, 'seeded')).token };
  }

  test('clears sessions and tokens, removes the password hash, keeps API_KEY, and says what to do next', async () => {
    const { session, token } = await seed(db);
    const fake = fakeEnvIo('API_KEY=app_kept\nAUTH_MODE=password\nAUTH_PASSWORD_HASH=scrypt.salt.hash\n');

    const code = await reset({ ...fake.io, db });

    const env = fake.files.get(FAKE_ENV_PATH) ?? '';
    expect(code).toBe(0);
    expect(await isLiveSession(db, session)).toBe(false);
    expect(await useToken(db, token)).toBe(false);
    expect(env).toBe('API_KEY=app_kept\nAUTH_MODE=password\n');
    expect(fake.out.join('')).toContain('bun run set-password');
  });

  test('in oidc mode it points at signing in again, and works without a .env', async () => {
    const oidc = fakeEnvIo('AUTH_MODE=oidc\n');
    const none = fakeEnvIo(null);

    expect(await reset({ ...oidc.io, db })).toBe(0);
    expect(await reset({ ...none.io, db })).toBe(0);
    expect(oidc.out.join('')).toContain('sign in again');
    expect(none.files.size).toBe(0);
  });
});
