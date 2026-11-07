import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { APP } from '../../src/app-config.ts';
import { CSRF_HEADER, SESSION_COOKIE } from '../../src/auth/cookies.ts';
import { hashPassword } from '../../src/auth/password-hash.ts';
import { ApiError, createAuthClient, type TokenSummary } from '../../src/web/api.ts';
import { createCookieJar, type CookieJar } from '../support/cookie-jar.ts';
import { startServiceProcess, type ServiceProcess } from '../support/service-process.ts';

const PASSWORD = 'auth-flow-test-password';
const WRONG_PASSWORD = 'not-the-password';

/** Wrong passwords the throttle lets through before it pauses the login. */
const THROTTLE_LIMIT = 5;

let service: ServiceProcess;
let jar: CookieJar;

/** The web client over the jar, so the session cookie rides along as it does in a browser. */
let client: ReturnType<typeof createAuthClient>;

/** Starts the service under password mode with a fresh jar and a client over it. */
async function startPasswordService(): Promise<void> {
  service = await startServiceProcess({
    AUTH_MODE: 'password',
    AUTH_PASSWORD_HASH: await hashPassword(PASSWORD),
    API_KEY: undefined,
  });
  jar = createCookieJar(service.origin);
  client = createAuthClient(Object.assign((input: string | URL | Request, init?: RequestInit) => jar.fetch(String(input), init), {
    preconnect: fetch.preconnect,
  }));
}

/** `GET /api/info` as an API client, with `token` as its bearer. */
function getInfo(token: string): Promise<Response> {
  return fetch(`${service.origin}/api/info`, { headers: { authorization: `Bearer ${token}` } });
}

/** A write sent through the jar with the JSON headers the client sends but not the CSRF header. */
function writeWithoutCsrf(method: string, path: string, body?: unknown): Promise<Response> {
  return jar.fetch(path, {
    method,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });
}

async function errorOf(response: Response): Promise<{ name: string; message: string }> {
  const envelope = (await response.json()) as { success: boolean; error: { name: string; message: string } };
  expect(envelope.success).toBe(false);
  return envelope.error;
}

describe('the sign-in flow against the running service', () => {
  beforeAll(startPasswordService);
  afterAll(async () => {
    await service.stop();
  });

  test('a token minted in this file opens GET /api/info as the app (stub control)', async () => {
    await client.login(PASSWORD);
    const minted = await client.createToken('control');
    const info = await getInfo(minted.token);
    const envelope = (await info.json()) as { data: { id: string } };
    expect(info.status).toBe(200);
    expect(envelope.data.id).toBe(APP.id);
    await client.revokeToken(minted.summary.id);
    await client.logout();
  });

  describe('a write without the CSRF header', () => {
    test('is refused with 403 on login and signs nothing in', async () => {
      const response = await writeWithoutCsrf('POST', '/auth/login', { password: PASSWORD });
      expect(response.status).toBe(403);
      const error = await errorOf(response);
      expect(error.name).toBe('Forbidden');
      expect(error.message).toContain(CSRF_HEADER);
      expect(jar.get(SESSION_COOKIE)).toBeUndefined();
      expect(await client.session()).toEqual({ mode: 'password', signedIn: false });
    });

    test('is refused with 403 on minting and revoking while signed in, and changes no token', async () => {
      await client.login(PASSWORD);
      const before = await client.listTokens();

      const mint = await writeWithoutCsrf('POST', '/auth/tokens', { name: 'no-csrf' });
      expect(mint.status).toBe(403);
      expect((await errorOf(mint)).name).toBe('Forbidden');

      const [existing] = before;
      const target = existing?.id ?? 1;
      const revoke = await writeWithoutCsrf('DELETE', `/auth/tokens/${target}`);
      expect(revoke.status).toBe(403);

      const logout = await writeWithoutCsrf('POST', '/auth/logout');
      expect(logout.status).toBe(403);

      expect(await client.listTokens()).toEqual(before);
      expect(await client.session()).toEqual({ mode: 'password', signedIn: true });
      await client.logout();
    });
  });

  describe('the whole flow, step by step', () => {
    let mintedToken: string;
    let mintedId: number;

    test('the session starts signed out', async () => {
      expect(await client.session()).toEqual({ mode: 'password', signedIn: false });
    });

    test('the token list is refused before sign-in', async () => {
      const failure = await client.listTokens().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(401);
    });

    test('a wrong password is refused with 401', async () => {
      const failure = await client.login(WRONG_PASSWORD).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(401);
      expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    });

    test('login signs in and sets the session cookie in the jar', async () => {
      expect(await client.login(PASSWORD)).toEqual({ signedIn: true });
      expect(jar.get(SESSION_COOKIE)).toBeDefined();
      expect(await client.session()).toEqual({ mode: 'password', signedIn: true });
    });

    test('the token list holds no active token yet', async () => {
      const tokens = await client.listTokens();
      expect(tokens.filter((token: TokenSummary) => token.revokedAt === null)).toEqual([]);
    });

    test('mint answers the token once and lists its summary', async () => {
      const created = await client.createToken('flow');
      expect(created.token.length).toBeGreaterThan(0);
      expect(created.summary.name).toBe('flow');
      expect(created.summary.revokedAt).toBeNull();
      mintedToken = created.token;
      mintedId = created.summary.id;

      const listed = (await client.listTokens()).find((token) => token.id === mintedId);
      expect(listed?.name).toBe('flow');
      expect(JSON.stringify(listed)).not.toContain(mintedToken);
    });

    test('GET /api/info with the token answers 200 as the app', async () => {
      const response = await getInfo(mintedToken);
      expect(response.status).toBe(200);
      const envelope = (await response.json()) as { success: boolean; data: { id: string } };
      expect(envelope.success).toBe(true);
      expect(envelope.data.id).toBe(APP.id);
    });

    test('revoke marks the token revoked in the list', async () => {
      const revoked = await client.revokeToken(mintedId);
      expect(revoked.id).toBe(mintedId);
      expect(revoked.revokedAt).not.toBeNull();
      const listed = (await client.listTokens()).find((token) => token.id === mintedId);
      expect(listed?.revokedAt).not.toBeNull();
    });

    test('the revoked token is refused with 401', async () => {
      const response = await getInfo(mintedToken);
      expect(response.status).toBe(401);
      expect((await errorOf(response)).name).toBe('Unauthorized');
    });

    test('logout signs out, drops the cookie and closes the token list', async () => {
      expect(await client.logout()).toEqual({ signedIn: false });
      expect(jar.get(SESSION_COOKIE)).toBeUndefined();
      expect(await client.session()).toEqual({ mode: 'password', signedIn: false });
      const failure = await client.listTokens().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(401);
    });
  });
});

describe('the login throttle, on its own service start', () => {
  beforeAll(startPasswordService);
  afterAll(async () => {
    await service.stop();
  });

  test('five wrong passwords are refused with 401 and the next attempt with 429, even with the right password', async () => {
    for (let attempt = 1; attempt <= THROTTLE_LIMIT; attempt += 1) {
      const failure = await client.login(WRONG_PASSWORD).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(401);
    }

    const wrong = await client.login(WRONG_PASSWORD).catch((error: unknown) => error);
    expect(wrong).toBeInstanceOf(ApiError);
    expect((wrong as ApiError).status).toBe(429);
    expect((wrong as ApiError).errorName).toBe('TooManyAttempts');

    const right = await client.login(PASSWORD).catch((error: unknown) => error);
    expect(right).toBeInstanceOf(ApiError);
    expect((right as ApiError).status).toBe(429);
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  test('the 429 carries a Retry-After in seconds', async () => {
    const response = await jar.fetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
      body: JSON.stringify({ password: WRONG_PASSWORD }),
    });
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  });
});
