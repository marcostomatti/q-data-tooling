import type { AuthConfig, OidcConfig } from '../../src/auth/config.ts';
import type { Db } from '../../src/data/repositories/db.ts';
import type { Log } from '../../src/logging.ts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';

import { APP } from '../../src/app-config.ts';
import { requireApiAccess } from '../../src/auth/access.ts';
import { LoginThrottle } from '../../src/auth/login-throttle.ts';
import { OidcClient } from '../../src/auth/oidc.ts';
import { hashPassword } from '../../src/auth/password-hash.ts';
import { authRouter } from '../../src/auth/routes.ts';
import { createToken, revokeToken } from '../../src/auth/store.ts';
import { captureLog, type CapturedLog, type LogRecord } from '../support/capture-log.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

import { startMockIssuer, type MockIssuer } from './mock-issuer.ts';

let db: SqliteTestClient;

beforeAll(() => {
  db = openMigratedMemoryDb();
});

afterAll(() => {
  db.$client.close();
});

const PASSWORD = 'a lockbox in a drawer';
const API_KEY = 'app_test-key-for-the-route-tests-only-0000000000';
const CSRF = { 'x-app-csrf': '1' };
/** The cookie names, after the app's id: `template-service_session` and `template-service_oidc`. */
const SESSION = `${APP.id}_session`;
const OIDC = `${APP.id}_oidc`;

interface Reply {
  readonly status: number
  readonly body: unknown
  readonly location: string | null
  readonly setCookies: string[]
  /** The reply's `x-request-id`: the trace id its log lines carry. */
  readonly requestId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A tiny browser: keeps the cookies the app sets, never follows redirects. */
interface Browser {
  request(method: string, path: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Reply>
  readonly cookies: Map<string, string>
}

interface App {
  readonly origin: string
  browser(): Browser
  close(): Promise<void>
}

async function startApp(db: Db, config: AuthConfig, oidcClient?: OidcClient, throttle?: LoginThrottle, log?: Log): Promise<App> {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter(db, config, { oidcClient, throttle, log }));
  app.use('/api', requireApiAccess(db, API_KEY, log));
  app.all('/api/echo', (_req, res) => {
    res.json({ success: true, data: 'through' });
  });
  const server: Server = await new Promise((ready) => {
    const listening = app.listen(0, () => ready(listening));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    browser(): Browser {
      const cookies = new Map<string, string>();
      return {
        cookies,
        async request(method, path, init = {}): Promise<Reply> {
          const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
          const response = await fetch(path.startsWith('http')
            ? path
            : `${origin}${path}`, {
            method,
            redirect: 'manual',
            headers: {
              ...(cookieHeader
                ? { cookie: cookieHeader }
                : {}),
              ...(init.body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
              ...init.headers,
            },
            ...(init.body === undefined
              ? {}
              : { body: JSON.stringify(init.body) }),
          });
          const setCookies = response.headers.getSetCookie();
          for (const line of setCookies) {
            const [pair = '', ...attributes] = line.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq);
            if (attributes.some((part) => part.trim() === 'Max-Age=0')) cookies.delete(name);
            else cookies.set(name, pair.slice(eq + 1));
          }
          const text = await response.text();
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
          return {
            status: response.status,
            body,
            location: response.headers.get('location'),
            setCookies,
            requestId: response.headers.get('x-request-id'),
          };
        },
      };
    },
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

describe('password mode', () => {
  let app: App;

  beforeAll(async () => {
    app = await startApp(db, { mode: 'password', passwordHash: await hashPassword(PASSWORD) });
  });
  afterAll(async () => {
    await app.close();
  });

  test('the right password sets an httpOnly, SameSite=Lax session cookie, and the session opens /api', async () => {
    const browser = app.browser();

    const login = await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });
    const session = await browser.request('GET', '/auth/session');
    const api = await browser.request('GET', '/api/echo');

    expect(login.status).toBe(200);
    expect(login.setCookies[0]).toMatch(new RegExp(`^${SESSION}=.+; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax$`));
    expect(session.body).toEqual({ success: true, data: { mode: 'password', signedIn: true } });
    expect(api.status).toBe(200);
  });

  test('a wrong password is a 401 and sets no cookie', async () => {
    const browser = app.browser();

    const login = await browser.request('POST', '/auth/login', { body: { password: 'nope' }, headers: CSRF });

    expect(login.status).toBe(401);
    expect(login.setCookies).toEqual([]);
  });

  test('a login without the CSRF header is refused before the password is read', async () => {
    const login = await app.browser().request('POST', '/auth/login', { body: { password: PASSWORD } });

    expect(login.status).toBe(403);
  });

  test('a session cookie with a forged signature opens nothing', async () => {
    const browser = app.browser();
    await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });
    const real = browser.cookies.get(SESSION) ?? '';
    browser.cookies.set(SESSION, `${real.slice(0, -2)}xx`);

    expect((await browser.request('GET', '/api/echo')).status).toBe(401);
  });

  test('a signed-in browser write needs the CSRF header; a read does not', async () => {
    const browser = app.browser();
    await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });

    expect((await browser.request('POST', '/api/echo')).status).toBe(403);
    expect((await browser.request('POST', '/api/echo', { headers: CSRF })).status).toBe(200);
  });

  test('signing out ends the session for good', async () => {
    const browser = app.browser();
    await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });
    const kept = browser.cookies.get(SESSION) ?? '';

    await browser.request('POST', '/auth/logout', { headers: CSRF });
    browser.cookies.set(SESSION, kept);

    expect((await browser.request('GET', '/api/echo')).status).toBe(401);
  });

  test('five wrong passwords pause the login, even for the right one', async () => {
    let now = 0;
    const paused = await startApp(db, { mode: 'password', passwordHash: await hashPassword(PASSWORD) }, undefined, new LoginThrottle(() => now));
    try {
      const browser = paused.browser();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await browser.request('POST', '/auth/login', { body: { password: 'wrong' }, headers: CSRF });
      }

      const blocked = await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });
      now += 61_000;
      const later = await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });

      expect(blocked.status).toBe(429);
      expect(later.status).toBe(200);
    } finally {
      await paused.close();
    }
  });

  test('a burst of parallel wrong passwords is counted as it arrives, so most of it is paused', async () => {
    const burst = await startApp(db, { mode: 'password', passwordHash: await hashPassword(PASSWORD) }, undefined, new LoginThrottle(() => 0));
    try {
      const browser = burst.browser();
      const replies = await Promise.all(
        Array.from({ length: 20 }, () => browser.request('POST', '/auth/login', { body: { password: 'wrong' }, headers: CSRF })),
      );

      expect(replies.filter((reply) => reply.status === 401).length).toBe(5);
      expect(replies.filter((reply) => reply.status === 429).length).toBe(15);
    } finally {
      await burst.close();
    }
  });
});

describe('API tokens over HTTP', () => {
  let app: App;
  let browser: Browser;

  beforeAll(async () => {
    app = await startApp(db, { mode: 'password', passwordHash: await hashPassword(PASSWORD) });
    browser = app.browser();
    await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });
  });
  afterAll(async () => {
    await app.close();
  });

  test('a signed-in user mints a token, sees it once, and it opens /api as a bearer', async () => {
    const minted = await browser.request('POST', '/auth/tokens', { body: { name: 'agent' }, headers: CSRF });
    const token = (minted.body as { data: { token: string } }).data.token;
    const listed = await browser.request('GET', '/auth/tokens');
    const asBearer = await fetch(`${app.origin}/api/echo`, { headers: { authorization: `Bearer ${token}` } });

    expect(minted.status).toBe(201);
    expect(JSON.stringify(listed.body)).not.toContain(token);
    expect(asBearer.status).toBe(200);
  });

  test('a revoked token is refused', async () => {
    const minted = await browser.request('POST', '/auth/tokens', { body: { name: 'short-lived' }, headers: CSRF });
    const { token, summary } = (minted.body as { data: { token: string; summary: { id: number } } }).data;

    const revoked = await browser.request('DELETE', `/auth/tokens/${summary.id}`, { headers: CSRF });
    const asBearer = await fetch(`${app.origin}/api/echo`, { headers: { authorization: `Bearer ${token}` } });

    expect(revoked.status).toBe(200);
    expect(asBearer.status).toBe(401);
  });

  test('a token cannot manage tokens: the list needs a sign-in', async () => {
    const { token } = await createToken(db, 'not a person');

    const response = await fetch(`${app.origin}/auth/tokens`, { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(401);
  });

  test('revoking an unknown id is a 404, and a bad id a 400', async () => {
    expect((await browser.request('DELETE', '/auth/tokens/999999', { headers: CSRF })).status).toBe(404);
    expect((await browser.request('DELETE', '/auth/tokens/abc', { headers: CSRF })).status).toBe(400);
  });

  test('a token without a name is a 400', async () => {
    expect((await browser.request('POST', '/auth/tokens', { body: { name: ' ' }, headers: CSRF })).status).toBe(400);
  });

  test('the API_KEY still opens /api, and a wrong bearer is refused even beside a good cookie', async () => {
    const withKey = await fetch(`${app.origin}/api/echo`, { headers: { authorization: `Bearer ${API_KEY}` } });
    const wrongBearer = await browser.request('GET', '/api/echo', { headers: { authorization: 'Bearer app_wrong' } });
    const malformed = await fetch(`${app.origin}/api/echo`, { headers: { authorization: `Bearer  ${API_KEY}` } });

    expect(withKey.status).toBe(200);
    expect(wrongBearer.status).toBe(401);
    expect(malformed.status).toBe(401);
  });

  test('a token revoked in the store is refused at once', async () => {
    const { token, summary } = await createToken(db, 'revoked directly');
    await revokeToken(db, summary.id);

    expect((await fetch(`${app.origin}/api/echo`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});

describe('no login configured', () => {
  test('the session route says so, and there is no login or token route', async () => {
    const app = await startApp(db, { mode: 'none' });
    try {
      const browser = app.browser();

      expect((await browser.request('GET', '/auth/session')).body).toEqual({ success: true, data: { mode: 'none', signedIn: false } });
      expect((await browser.request('POST', '/auth/login', { body: { password: 'x' }, headers: CSRF })).status).toBe(404);
      expect((await browser.request('GET', '/auth/tokens')).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('a failed credential check', () => {
  test('answers 500 and logs the failure signed `Auth:access`, with its reason and not the token', async () => {
    // Arrange: a database with no query builder, so the token lookup throws a TypeError.
    const captured = captureLog();
    const broken = await startApp({} as unknown as Db, { mode: 'none' }, undefined, undefined, captured.log);
    const token = 'app_presented-token-'.concat('d'.repeat(20));
    try {
      // Act
      const reply = await broken.browser().request('GET', '/api/echo', { headers: { authorization: `Bearer ${token}` } });

      // Assert
      expect(reply.status).toBe(500);
      expect(captured.records).toEqual([
        { domain: 'Auth', scope: 'access', step: 'checkCredential', reason: 'TypeError', level: 'error', msg: 'the credential check failed' },
      ]);
      expect(JSON.stringify(captured.records)).not.toContain(token);
    } finally {
      await broken.close();
    }
  });
});

describe('a failed auth route', () => {
  /** The 500 line a failed auth route writes: domain `Auth`, its scope and step, under the reply's trace id. */
  function failureLine(reply: Reply, scope: string, step: string): LogRecord {
    return { domain: 'Auth', traceId: reply.requestId, scope, step, err: expect.any(Error), level: 'error', msg: 'request failed' };
  }

  test('answers 500 and logs it signed, under the trace id it answers, when the database fails', async () => {
    // Arrange: a database with no query builder, so the first query a route makes throws a TypeError.
    const captured = captureLog();
    const broken = await startApp({} as unknown as Db, { mode: 'password', passwordHash: await hashPassword(PASSWORD) }, undefined, undefined, captured.log);
    const browser = broken.browser();
    browser.cookies.set(SESSION, 'any-signed-value');
    try {
      // Act
      const session = await browser.request('GET', '/auth/session');
      const logout = await browser.request('POST', '/auth/logout', { headers: CSRF });
      const login = await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });
      const tokens = await browser.request('GET', '/auth/tokens');

      // Assert
      expect([session, logout, login, tokens].map((reply) => reply.status)).toEqual([500, 500, 500, 500]);
      expect(session.requestId).toMatch(UUID);
      expect(captured.records).toEqual([
        failureLine(session, 'session', 'readSession'),
        failureLine(logout, 'logout', 'endSession'),
        failureLine(login, 'login', 'signIn'),
        failureLine(tokens, 'tokens', 'checkSession'),
      ]);
    } finally {
      await broken.close();
    }
  });

  test('a token route whose store fails after the sign-in logs its own step', async () => {
    // Arrange: a database of its own, signed in, whose token table is then dropped.
    const own = openMigratedMemoryDb();
    const captured = captureLog();
    const app = await startApp(own, { mode: 'password', passwordHash: await hashPassword(PASSWORD) }, undefined, undefined, captured.log);
    const browser = app.browser();
    try {
      await browser.request('POST', '/auth/login', { body: { password: PASSWORD }, headers: CSRF });
      own.$client.run('DROP TABLE `api_token`');

      // Act
      const listed = await browser.request('GET', '/auth/tokens');
      const minted = await browser.request('POST', '/auth/tokens', { body: { name: 'agent' }, headers: CSRF });
      const revoked = await browser.request('DELETE', '/auth/tokens/1', { headers: CSRF });

      // Assert
      expect([listed, minted, revoked].map((reply) => reply.status)).toEqual([500, 500, 500]);
      expect(captured.records).toEqual([
        failureLine(listed, 'tokens', 'listTokens'),
        failureLine(minted, 'tokens', 'createToken'),
        failureLine(revoked, 'tokens', 'revokeToken'),
      ]);
    } finally {
      await app.close();
      own.$client.close();
    }
  });

  test('keeps a caller\'s valid x-request-id, and answers one on a refusal and an unknown route too', async () => {
    // Arrange
    const captured = captureLog();
    const broken = await startApp({} as unknown as Db, { mode: 'password', passwordHash: await hashPassword(PASSWORD) }, undefined, undefined, captured.log);
    const browser = broken.browser();
    browser.cookies.set(SESSION, 'any-signed-value');
    try {
      // Act
      const failed = await browser.request('GET', '/auth/session', { headers: { 'x-request-id': 'caller-trace-1' } });
      const refused = await broken.browser().request('POST', '/auth/logout');
      const missing = await broken.browser().request('GET', '/auth/nowhere');

      // Assert
      expect(failed.requestId).toBe('caller-trace-1');
      expect(captured.records[0]).toMatchObject({ traceId: 'caller-trace-1' });
      expect([refused.status, missing.status]).toEqual([403, 404]);
      expect(refused.requestId).toMatch(UUID);
      expect(missing.requestId).toMatch(UUID);
    } finally {
      await broken.close();
    }
  });
});

describe('oidc mode, against the in-process mock issuer', () => {
  const CLIENT_ID = 'service-route-client';
  let issuer: MockIssuer;
  let app: App;
  let config: OidcConfig;
  let captured: CapturedLog;

  beforeAll(async () => {
    issuer = await startMockIssuer(CLIENT_ID);
    config = {
      mode: 'oidc',
      issuer: issuer.issuer,
      clientId: CLIENT_ID,
      redirectUri: 'http://localhost/auth/oidc/callback',
      scopes: ['openid', 'email'],
      allowedSubject: 'the-one-user',
    };
    captured = captureLog();
    app = await startApp(db, config, new OidcClient(config), undefined, captured.log);
  });
  afterAll(async () => {
    await app.close();
    await issuer.stop();
  });

  /** Starts a sign-in and has the provider approve it, returning the callback path. */
  async function throughProvider(browser: Browser, claims: Record<string, unknown>): Promise<{ callback: string; state: string }> {
    const start = await browser.request('GET', '/auth/oidc/start');
    const authorize = new URL(start.location ?? '');
    const code = issuer.approve(authorize.toString(), claims);
    const state = authorize.searchParams.get('state') ?? '';
    return { callback: `/auth/oidc/callback?code=${code}&state=${state}`, state };
  }

  test('the start redirects to the provider and keeps the attempt in a short, path-scoped cookie', async () => {
    const start = await app.browser().request('GET', '/auth/oidc/start');

    expect(start.status).toBe(302);
    expect(start.location?.startsWith(`${issuer.issuer}/authorize?`)).toBe(true);
    expect(start.setCookies[0]).toMatch(new RegExp(`^${OIDC}=.+; Path=/auth/oidc; Max-Age=600; HttpOnly; SameSite=Lax$`));
  });

  test('the allowed subject comes back signed in and the session opens /api', async () => {
    const browser = app.browser();
    const { callback } = await throughProvider(browser, { sub: 'the-one-user' });

    const back = await browser.request('GET', callback);

    expect(back.status).toBe(302);
    expect(back.location).toBe('/');
    expect(browser.cookies.has(OIDC)).toBe(false);
    expect((await browser.request('GET', '/api/echo')).status).toBe(200);
  });

  test('another subject is sent back to the login page with no session', async () => {
    const browser = app.browser();
    const { callback } = await throughProvider(browser, { sub: 'someone-else' });

    const back = await browser.request('GET', callback);

    expect(back.location).toBe('/login?error=oidc');
    expect(browser.cookies.has(SESSION)).toBe(false);
  });

  test('a callback whose state does not match the attempt is refused', async () => {
    const browser = app.browser();
    const { callback, state } = await throughProvider(browser, { sub: 'the-one-user' });

    const back = await browser.request('GET', callback.replace(state, 'forged-state'));

    expect(back.location).toBe('/login?error=oidc');
    expect(browser.cookies.has(SESSION)).toBe(false);
  });

  test('a callback in a browser that never started a sign-in is refused', async () => {
    const starter = app.browser();
    const { callback } = await throughProvider(starter, { sub: 'the-one-user' });

    const back = await app.browser().request('GET', callback);

    expect(back.location).toBe('/login?error=oidc');
    expect(captured.records.at(-1)).toEqual({
      domain: 'Auth',
      traceId: back.requestId,
      scope: 'callback',
      step: 'completeLogin',
      reason: 'no sign-in attempt is pending in this browser',
      level: 'warn',
      msg: 'OIDC sign-in refused',
    });
  });

  test('a start whose discovery fails is sent back to the login page and logged signed `Auth:login`', async () => {
    // Arrange: a client whose provider answers every discovery with 500.
    const failing = captureLog();
    const failingFetch: typeof fetch = Object.assign(
      async () => new Response('', { status: 500 }),
      { preconnect: fetch.preconnect },
    );
    const unreachable = new OidcClient(config, failingFetch);
    const down = await startApp(db, config, unreachable, undefined, failing.log);
    try {
      // Act
      const start = await down.browser().request('GET', '/auth/oidc/start');

      // Assert
      expect(start.location).toBe('/login?error=oidc');
      expect(failing.records).toEqual([
        {
          domain: 'Auth',
          traceId: start.requestId,
          scope: 'login',
          step: 'authorize',
          reason: 'discovery answered 500',
          level: 'error',
          msg: 'OIDC sign-in could not start',
        },
      ]);
    } finally {
      await down.close();
    }
  });

  test('there is no password login in oidc mode', async () => {
    expect((await app.browser().request('POST', '/auth/login', { body: { password: 'x' }, headers: CSRF })).status).toBe(404);
  });
});
