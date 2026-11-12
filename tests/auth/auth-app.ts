/**
 * The `/auth` routes and the `/api` credential check on a bare Express app, and a tiny browser
 * that keeps the cookies the app sets, shared by the route tests that need no database
 * (`tests/auth/routes.test.ts`) and the ones that run on Postgres
 * (`tests/integration/auth/routes.test.ts`).
 *
 * @module
 */

import type { AuthConfig } from '../../src/auth/config.ts';
import type { LoginThrottle } from '../../src/auth/login-throttle.ts';
import type { OidcClient } from '../../src/auth/oidc.ts';
import type { Db } from '../../src/data/repositories/db.ts';
import type { Log } from '../../src/logging.ts';
import type { LogRecord } from '../support/capture-log.ts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect } from 'bun:test';
import express from 'express';

import { APP } from '../../src/app-config.ts';
import { requireApiAccess } from '../../src/auth/access.ts';
import { authRouter } from '../../src/auth/routes.ts';

/** The password the route tests sign in with; made up for them. */
export const PASSWORD = 'a lockbox in a drawer';

/** The `API_KEY` the app's `/api` check takes; made up for the route tests. */
export const API_KEY = 'app_test-key-for-the-route-tests-only-0000000000';

/** The header a signed-in browser write must send. */
export const CSRF = { 'x-app-csrf': '1' };

/** The session cookie's name, after the app's id: `template-service_session`. */
export const SESSION = `${APP.id}_session`;

/** The OIDC attempt cookie's name, after the app's id: `template-service_oidc`. */
export const OIDC = `${APP.id}_oidc`;

/** A v4-shaped UUID, the form of a trace id the app picks itself. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One reply as the tiny browser reads it. */
export interface Reply {
  readonly status: number
  readonly body: unknown
  readonly location: string | null
  readonly setCookies: string[]
  /** The reply's `x-request-id`: the trace id its log lines carry. */
  readonly requestId: string | null
}

/** A tiny browser: keeps the cookies the app sets, never follows redirects. */
export interface Browser {
  request(method: string, path: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Reply>
  readonly cookies: Map<string, string>
}

/** A running app, a browser on it, and its `close()`. */
export interface App {
  readonly origin: string
  browser(): Browser
  close(): Promise<void>
}

/** Reads a reply's body as JSON, or as text when it is not JSON. */
function parsedBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Keeps each cookie a reply sets in `cookies`, and drops each one it clears with `Max-Age=0`. */
function keepCookies(cookies: Map<string, string>, setCookies: readonly string[]): void {
  for (const line of setCookies) {
    const [pair = '', ...attributes] = line.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    if (attributes.some((part) => part.trim() === 'Max-Age=0')) cookies.delete(name);
    else cookies.set(name, pair.slice(eq + 1));
  }
}

/** A browser on `origin` with a cookie jar of its own. */
function browserOn(origin: string): Browser {
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
      keepCookies(cookies, setCookies);
      return {
        status: response.status,
        body: parsedBody(await response.text()),
        location: response.headers.get('location'),
        setCookies,
        requestId: response.headers.get('x-request-id'),
      };
    },
  };
}

/**
 * Mounts `authRouter` on `/auth` and `requireApiAccess` on `/api`, with `/api/echo` behind it,
 * and listens on a port the OS picks.
 *
 * @param db - The database the routes read; a stand-in for a test that reads none.
 * @param config - The login mode.
 * @param oidcClient - The OIDC client for `oidc` mode.
 * @param throttle - The login throttle; the router's own by default.
 * @param log - The base log the routes write to; a capturing fake in a test that reads it.
 * @returns The running app.
 */
export async function startApp(db: Db, config: AuthConfig, oidcClient?: OidcClient, throttle?: LoginThrottle, log?: Log): Promise<App> {
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
    browser: () => browserOn(origin),
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/**
 * The 500 line a failed auth route writes: domain `Auth`, its scope and step, under the reply's
 * trace id.
 *
 * @param reply - The reply the line belongs to.
 * @param scope - The route's scope.
 * @param step - The step that failed.
 * @returns The record to match.
 */
export function failureLine(reply: Reply, scope: string, step: string): LogRecord {
  return { domain: 'Auth', traceId: reply.requestId, scope, step, err: expect.any(Error), level: 'error', msg: 'request failed' };
}
