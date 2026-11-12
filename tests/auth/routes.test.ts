import type { Db } from '../../src/data/repositories/db.ts';

import { describe, expect, test } from 'bun:test';

import { hashPassword } from '../../src/auth/password-hash.ts';
import { captureLog } from '../support/capture-log.ts';

import { CSRF, failureLine, PASSWORD, SESSION, startApp, UUID } from './auth-app.ts';

// The routes that read the database are tested on Postgres, in tests/integration/auth/routes.test.ts.

describe('no login configured', () => {
  test('the session route says so, and there is no login or token route', async () => {
    // Arrange: a database with no query builder, because in this mode no route reads one.
    const app = await startApp({} as unknown as Db, { mode: 'none' });
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
