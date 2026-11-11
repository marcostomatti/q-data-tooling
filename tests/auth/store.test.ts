import type { SqliteTestClient } from '../support/sqlite-db.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
  sign,
  tokenName,
  unsign,
  useToken,
} from '../../src/auth/store.ts';
import { apiToken, appConfig, authSession } from '../../src/data/active.ts';
import { NotFoundError } from '../../src/errors.ts';
import { openMigratedMemoryDb } from '../support/sqlite-db.ts';

let db: SqliteTestClient;

beforeEach(() => {
  db = openMigratedMemoryDb();
});

afterEach(() => {
  db.$client.close();
});

describe('sign and unsign', () => {
  test('a signed value comes back; a changed value or signature does not', () => {
    const signed = sign('abc', 'secret-one');

    expect(unsign(signed, 'secret-one')).toBe('abc');
    expect(unsign(signed, 'secret-two')).toBeUndefined();
    expect(unsign(`x${signed}`, 'secret-one')).toBeUndefined();
    expect(unsign(`${signed}x`, 'secret-one')).toBeUndefined();
    expect(unsign('no-signature', 'secret-one')).toBeUndefined();
  });
});

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
    // Whole seconds: SQLite keeps a timestamp to the second.
    const at = new Date('2026-03-04T05:06:07Z');
    const { token, summary } = await createToken(db, 'timed');

    await useToken(db, token, at);

    const listed = (await listTokens(db)).find((entry) => entry.id === summary.id);
    expect(listed?.lastUsedAt).toBe(at.toISOString());
  });

  test('revoking a token records the time it is given', async () => {
    const at = new Date('2026-03-04T05:06:07Z');
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

  test.each([['', 'empty'], ['   ', 'blank'], ['x'.repeat(81), 'too long'], [42, 'not text']])(
    'a token name %p (%s) is refused',
    (raw) => {
      expect(() => tokenName(raw)).toThrow(/name/);
    },
  );

  test('a token name is trimmed', () => {
    expect(tokenName('  laptop  ')).toBe('laptop');
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
    let deletes = 0;
    const failingThirdDelete = new Proxy(db, {
      get(target, property): unknown {
        const member: unknown = Reflect.get(target, property, target);
        if (property !== 'delete' || typeof member !== 'function') return member;
        return (...args: unknown[]): unknown => {
          deletes += 1;
          if (deletes === 3) throw new Error('the disk is full');
          return member.apply(target, args);
        };
      },
    });

    await expect(clearCredentials(failingThirdDelete)).rejects.toThrow('the disk is full');

    expect(deletes).toBe(3);
    expect(await db.select().from(authSession)).toHaveLength(1);
    expect(await db.select().from(apiToken)).toHaveLength(1);
  });
});
