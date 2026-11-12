import type { Db } from '../../src/data/repositories/db.ts';

import { describe, expect, test } from 'bun:test';

import { readEnvValue } from '../../src/auth/env-file.ts';
import { verifyPassword } from '../../src/auth/password-hash.ts';
import { main as reset } from '../../src/auth/reset-credentials.ts';
import { main as setPassword } from '../../src/auth/set-password.ts';

import { FAKE_ENV_PATH, fakeEnvIo } from './fake-env-io.ts';

// `reset-credentials` on a real database is tested on Postgres, in
// tests/integration/auth/credential-scripts.test.ts.

describe('bun run set-password', () => {
  test('writes a hash of the password, sets AUTH_MODE=password, and prints no password', async () => {
    const fake = fakeEnvIo('DATABASE_URL=postgres://example\n', ['a good password', 'a good password']);

    const code = await setPassword(fake.io);

    const env = fake.files.get(FAKE_ENV_PATH) ?? '';
    expect(code).toBe(0);
    expect(readEnvValue(env, 'AUTH_MODE')).toBe('password');
    expect(await verifyPassword('a good password', readEnvValue(env, 'AUTH_PASSWORD_HASH') ?? '')).toBe(true);
    expect(env).not.toContain('a good password');
    expect(fake.out.join('')).not.toContain('a good password');
  });

  test('two different answers change nothing', async () => {
    const fake = fakeEnvIo('A=1\n', ['one', 'two']);

    expect(await setPassword(fake.io)).toBe(1);
    expect(fake.files.get(FAKE_ENV_PATH)).toBe('A=1\n');
  });

  test('an existing oidc mode is kept, with a note on how to switch', async () => {
    const fake = fakeEnvIo('AUTH_MODE=oidc\n', ['pw-long-enough', 'pw-long-enough']);

    await setPassword(fake.io);

    expect(readEnvValue(fake.files.get(FAKE_ENV_PATH) ?? '', 'AUTH_MODE')).toBe('oidc');
    expect(fake.out.join('')).toContain('AUTH_MODE=password');
  });
});

describe('bun run reset-credentials', () => {
  test('a database that cannot be reached is reported, and .env is left as it was', async () => {
    const fake = fakeEnvIo('AUTH_PASSWORD_HASH=scrypt.salt.hash\n');
    // A client whose every statement fails as a refused connection does. On Postgres `transact`
    // opens with the client's `transaction`, so that is the call that fails first.
    const refused = (): Promise<never> => Promise.reject(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }));
    const failingStatement = { returning: refused, where: refused };
    const broken = { transaction: refused, delete: () => failingStatement } as unknown as Db;

    expect(await reset({ ...fake.io, db: broken })).toBe(1);
    expect(fake.err.join('')).toContain('ECONNREFUSED');
    expect(fake.files.get(FAKE_ENV_PATH)).toBe('AUTH_PASSWORD_HASH=scrypt.salt.hash\n');
  });
});
