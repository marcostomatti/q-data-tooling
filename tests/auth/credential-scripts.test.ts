import type { Db } from '../../src/data/repositories/db.ts';

import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { readEnvValue } from '../../src/auth/env-file.ts';
import { verifyPassword } from '../../src/auth/password-hash.ts';
import { main as reset } from '../../src/auth/reset-credentials.ts';
import { main as setPassword } from '../../src/auth/set-password.ts';
import { createSession, createToken, isLiveSession, useToken } from '../../src/auth/store.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

let db: SqliteTestClient;

beforeAll(() => {
  db = openMigratedMemoryDb();
});

afterAll(() => {
  db.$client.close();
});

/** An in-memory `.env` and terminal. */
function fakeIo(initial: string | null, answers: string[] = []) {
  const files = new Map<string, string>();
  if (initial !== null) files.set('/fake/.env', initial);
  const out: string[] = [];
  const err: string[] = [];
  return {
    files,
    out,
    err,
    io: {
      envPath: '/fake/.env',
      readFile: async (path: string) => files.get(path) ?? null,
      writeFile: async (path: string, text: string) => void files.set(path, text),
      askSecret: async () => answers.shift() ?? '',
      write: (text: string) => void out.push(text),
      writeError: (text: string) => void err.push(text),
    },
  };
}

describe('bun run set-password', () => {
  test('writes a hash of the password, sets AUTH_MODE=password, and prints no password', async () => {
    const fake = fakeIo('DATABASE_URL=postgres://example\n', ['a good password', 'a good password']);

    const code = await setPassword(fake.io);

    const env = fake.files.get('/fake/.env') ?? '';
    expect(code).toBe(0);
    expect(readEnvValue(env, 'AUTH_MODE')).toBe('password');
    expect(await verifyPassword('a good password', readEnvValue(env, 'AUTH_PASSWORD_HASH') ?? '')).toBe(true);
    expect(env).not.toContain('a good password');
    expect(fake.out.join('')).not.toContain('a good password');
  });

  test('two different answers change nothing', async () => {
    const fake = fakeIo('A=1\n', ['one', 'two']);

    expect(await setPassword(fake.io)).toBe(1);
    expect(fake.files.get('/fake/.env')).toBe('A=1\n');
  });

  test('an existing oidc mode is kept, with a note on how to switch', async () => {
    const fake = fakeIo('AUTH_MODE=oidc\n', ['pw-long-enough', 'pw-long-enough']);

    await setPassword(fake.io);

    expect(readEnvValue(fake.files.get('/fake/.env') ?? '', 'AUTH_MODE')).toBe('oidc');
    expect(fake.out.join('')).toContain('AUTH_MODE=password');
  });
});

describe('bun run reset-credentials', () => {
  async function seed(db: Db): Promise<{ session: string; token: string }> {
    return { session: await createSession(db), token: (await createToken(db, 'seeded')).token };
  }

  test('clears sessions and tokens, removes the password hash, keeps API_KEY, and says what to do next', async () => {
    const { session, token } = await seed(db);
    const fake = fakeIo('API_KEY=app_kept\nAUTH_MODE=password\nAUTH_PASSWORD_HASH=scrypt.salt.hash\n');

    const code = await reset({ ...fake.io, db: db });

    const env = fake.files.get('/fake/.env') ?? '';
    expect(code).toBe(0);
    expect(await isLiveSession(db, session)).toBe(false);
    expect(await useToken(db, token)).toBe(false);
    expect(env).toBe('API_KEY=app_kept\nAUTH_MODE=password\n');
    expect(fake.out.join('')).toContain('bun run set-password');
  });

  test('in oidc mode it points at signing in again, and works without a .env', async () => {
    const oidc = fakeIo('AUTH_MODE=oidc\n');
    const none = fakeIo(null);

    expect(await reset({ ...oidc.io, db: db })).toBe(0);
    expect(await reset({ ...none.io, db: db })).toBe(0);
    expect(oidc.out.join('')).toContain('sign in again');
    expect(none.files.size).toBe(0);
  });

  test('a database that cannot be reached is reported, and .env is left as it was', async () => {
    const fake = fakeIo('AUTH_PASSWORD_HASH=scrypt.salt.hash\n');
    // A client whose every statement fails as a refused connection does: transact opens on its
    // SQLite connection, and on Postgres its `transaction` is the call that fails.
    const refused = (): Promise<never> => Promise.reject(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }));
    const failingStatement = { returning: refused, where: refused };
    const connection = new Database(':memory:');
    const broken = { $client: connection, transaction: refused, delete: () => failingStatement } as unknown as Db;

    expect(await reset({ ...fake.io, db: broken })).toBe(1);
    expect(fake.err.join('')).toContain('ECONNREFUSED');
    expect(fake.files.get('/fake/.env')).toBe('AUTH_PASSWORD_HASH=scrypt.salt.hash\n');
    connection.close();
  });
});
