import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'bun:test';

import { authModeOf, exportOpenApi } from '../../scripts/export-openapi.ts';

const scratch = await mkdtemp(join(tmpdir(), 'export-openapi-'));

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('the OpenAPI export', () => {
  test('reads the sign-in mode, defaulting to none, and refuses any other value', () => {
    expect(authModeOf(undefined)).toBe('none');
    expect(authModeOf('')).toBe('none');
    expect(authModeOf('oidc')).toBe('oidc');
    expect(() => authModeOf('ldap')).toThrow('not ldap');
  });

  test('writes the document with the /auth routes of the mode it is given', async () => {
    const out = join(scratch, 'nested', 'openapi.json');

    await exportOpenApi(out, 'password');
    const paths = Object.keys((JSON.parse(await readFile(out, 'utf8')) as { paths: object }).paths);

    expect(paths).toContain('/auth/login');
    expect(paths).toContain('/api/info');
  });
});
