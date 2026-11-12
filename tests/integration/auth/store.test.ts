import type { Db } from '../../../src/data/repositories/db.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  clearCredentials,
  COOKIE_SECRET_KEY,
  cookieSecret,
  createSession,
  createToken,
  deleteSession,
  isLiveSession,
  listTokens,
  revokeToken,
  useToken,
} from '../../../src/auth/store.ts';
import { apiToken, appConfig, authSession } from '../../../src/data/active.ts';
import { NotFoundError } from '../../../src/errors.ts';
import { openTestDatabase } from '../../support/test-db.ts';

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

/**
 * `client` with its `delete` failing on the `failAt`-th call. On Postgres `transact` runs its
 * body on the `tx` drizzle's `transaction` hands it, so the count follows the client into every
 * transaction it opens, and a delete made on `tx` is counted too.
 */
function failingNthDelete(client: Db, failAt: number): { readonly db: Db; deletes(): number } {
  let deletes = 0;
  const wrap = <T extends object>(target: T): T => new Proxy(target, {
    get(inner, property): unknown {
      const member: unknown = Reflect.get(inner, property, inner);
      if (typeof member !== 'function') return member;
      if (property === 'delete') {
        return (...args: unknown[]): unknown => {
          deletes += 1;
          if (deletes === failAt) throw new Error('the disk is full');
          return member.apply(inner, args);
        };
      }
      if (property === 'transaction') {
        return (body: (tx: object) => unknown, ...rest: unknown[]): unknown => member.call(inner, (tx: object) => body(wrap(tx)), ...rest);
      }
      return member;
    },
  });
  return { db: wrap(client), deletes: () => deletes };
}

describe('cookieSecret', () => {
  test('is made once and read back the same on every call', async () => {
    const first = await cookieSecret(db);
    const [second, third] = await Promise.all([cookieSecret(db), cookieSecret(db)]);

    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

describe('sessions', () => {
  test('a new session is live, and stores only a hash of its id', async () => {
    const id = await createSession(db);

    expect(await isLiveSession(db, id)).toBe(true);
    const stored = await db.select().from(authSession);
    expect(stored.some((row) => row.idHash === id)).toBe(false);
  });

  test('an expired session is not live, and a later sign-in sweeps it', async () => {
    const longAgo = new Date('2020-01-01T00:00:00Z');
    const old = await createSession(db, longAgo);

    expect(await isLiveSession(db, old)).toBe(false);
    await createSession(db);
    const rows = await db.select().from(authSession);
    expect(rows.every((row) => row.expiresAt > new Date())).toBe(true);
  });

  test('a deleted session is no longer live, and an unknown id never was', async () => {
    const id = await createSession(db);

    await deleteSession(db, id);

    expect(await isLiveSession(db, id)).toBe(false);
    expect(await isLiveSession(db, 'never-issued')).toBe(false);
  });
});

describe('API tokens', () => {
  test('a minted token is shown once, stored as a hash, and opens access', async () => {
    const { token, summary } = await createToken(db, 'research agent');

    expect(token.startsWith('app_')).toBe(true);
    expect(summary).toMatchObject({ name: 'research agent', prefix: token.slice(0, 8), lastUsedAt: null, revokedAt: null });
    const [row] = await db.select().from(apiToken)
      .where(eq(apiToken.id, summary.id));
    expect(row?.tokenHash).not.toContain(token);
    expect(JSON.stringify(await listTokens(db))).not.toContain(token);
    expect(await useToken(db, token)).toBe(true);
  });

  test('using a token records when', async () => {
    const { token, summary } = await createToken(db, 'cli');

    await useToken(db, token);

    const listed = (await listTokens(db)).find((entry) => entry.id === summary.id);
    expect(listed?.lastUsedAt).not.toBeNull();
  });

  test('using a token records the time it is given', async () => {
    // Postgres keeps a timestamp to the microsecond, so the milliseconds come back as given.
    const at = new Date('2026-03-04T05:06:07.089Z');
    const { token, summary } = await createToken(db, 'timed');

    await useToken(db, token, at);

    const listed = (await listTokens(db)).find((entry) => entry.id === summary.id);
    expect(listed?.lastUsedAt).toBe(at.toISOString());
  });

  test('revoking a token records the time it is given', async () => {
    const at = new Date('2026-03-04T05:06:07.089Z');
    const { summary } = await createToken(db, 'revoked at a time');

    const revoked = await revokeToken(db, summary.id, at);

    expect(revoked.revokedAt).toBe(at.toISOString());
  });

  test('a revoked token stays listed and opens nothing', async () => {
    const { token, summary } = await createToken(db, 'to revoke');

    const revoked = await revokeToken(db, summary.id);
    const again = await revokeToken(db, summary.id);

    expect(revoked.revokedAt).not.toBeNull();
    expect(again.revokedAt).toBe(revoked.revokedAt);
    expect(await useToken(db, token)).toBe(false);
    expect((await listTokens(db)).some((entry) => entry.id === summary.id)).toBe(true);
  });

  test('revoking a token that does not exist is a NotFoundError', async () => {
    await expect(revokeToken(db, 999_999)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('an unknown token opens nothing', async () => {
    expect(await useToken(db, 'app_not-a-real-token')).toBe(false);
  });
});

describe('clearCredentials', () => {
  test('removes every session, every token and the cookie secret', async () => {
    await createSession(db);
    const { token } = await createToken(db, 'cleared');
    await cookieSecret(db);

    const cleared = await clearCredentials(db);

    expect(cleared.sessions).toBeGreaterThan(0);
    expect(cleared.tokens).toBeGreaterThan(0);
    expect(await db.select().from(authSession)).toEqual([]);
    expect(await db.select().from(apiToken)).toEqual([]);
    expect(await db.select().from(appConfig)
      .where(eq(appConfig.key, COOKIE_SECRET_KEY))).toEqual([]);
    expect(await useToken(db, token)).toBe(false);
  });

  test('a second run clears nothing and still succeeds', async () => {
    await createSession(db);
    await clearCredentials(db);

    const again = await clearCredentials(db);

    expect(again).toEqual({ sessions: 0, tokens: 0 });
  });

  test('a failure part-way rolls back the deletes that ran before it', async () => {
    await createSession(db);
    await createToken(db, 'kept');
    const failing = failingNthDelete(db, 3);

    await expect(clearCredentials(failing.db)).rejects.toThrow('the disk is full');

    expect(failing.deletes()).toBe(3);
    expect(await database.sql`select id_hash from auth_session`).toHaveLength(1);
    expect(await database.sql`select id from api_token`).toHaveLength(1);
  });
});
