import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { APP } from '../../src/app-config.ts';
import {
  createdToken,
  createTokenInput,
  loginInput,
  sessionState,
  signInState,
  tokenIdParam,
  tokenSummary,
} from '../../src/auth/contract.ts';
import { hashPassword } from '../../src/auth/password-hash.ts';
import { createAuthClient } from '../../src/web/api.ts';
import { createCookieJar, type CookieJar } from '../support/cookie-jar.ts';
import { startServiceProcess, type ServiceProcess } from '../support/service-process.ts';

const PASSWORD = 'contract-test-password';

/** One call the web client made: where it went and what it sent. */
type Sent = { readonly path: string; readonly method: string; readonly headers: Headers; readonly body: unknown };

let service: ServiceProcess;
let jar: CookieJar;
let sent: Sent[] = [];
/** What the service answered to each call, as the `data` of its envelope. */
let answers: unknown[] = [];

/** The web client over the jar, recording each request it sends and the `data` the service answers. */
const recordingFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const path = String(input);
  const response = await jar.fetch(path, init);
  const raw = typeof init?.body === 'string'
    ? init.body
    : undefined;
  sent.push({
    path,
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    body: raw === undefined
      ? undefined
      : JSON.parse(raw),
  });
  const envelope = (await response.clone().json()) as { success: boolean; data?: unknown };
  expect(envelope.success).toBe(true);
  answers.push(envelope.data);
  return response;
};
const client = createAuthClient(Object.assign(recordingFetch, { preconnect: fetch.preconnect }));

/** Clears the record, runs one client call and returns what it sent and the service's raw `data`. */
async function observe(call: () => Promise<unknown>): Promise<{ request: Sent; data: unknown }> {
  sent = [];
  answers = [];
  await call();
  expect(sent).toHaveLength(1);
  const [request] = sent;
  return { request: request as Sent, data: answers[0] };
}

beforeAll(async () => {
  service = await startServiceProcess({
    AUTH_MODE: 'password',
    AUTH_PASSWORD_HASH: await hashPassword(PASSWORD),
    API_KEY: undefined,
  });
  jar = createCookieJar(service.origin);
});

afterAll(async () => {
  await service.stop();
});

describe('the /auth routes against the running service', () => {
  test('a token minted in this file opens GET /api/info as the app (stub control)', async () => {
    await client.login(PASSWORD);
    const minted = await client.createToken('control');
    const info = await fetch(`${service.origin}/api/info`, { headers: { authorization: `Bearer ${minted.token}` } });
    const envelope = (await info.json()) as { data: { id: string } };
    expect(info.status).toBe(200);
    expect(envelope.data.id).toBe(APP.id);
    await client.logout();
  });

  test('GET /auth/session sends no body and answers a strict session state', async () => {
    const { request, data } = await observe(() => client.session());
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/auth/session');
    expect(request.body).toBeUndefined();
    expect(sessionState.parse(data)).toEqual({ mode: 'password', signedIn: false });
  });

  test('POST /auth/login sends a body the input schema accepts and answers a strict sign-in state', async () => {
    const { request, data } = await observe(() => client.login(PASSWORD));
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/auth/login');
    expect(request.headers.get('x-app-csrf')).toBe('1');
    expect(loginInput.parse(request.body)).toEqual({ password: PASSWORD });
    expect(signInState.parse(data)).toEqual({ signedIn: true });
  });

  test('GET /auth/tokens sends no body and answers a list of strict summaries', async () => {
    const { request, data } = await observe(() => client.listTokens());
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/auth/tokens');
    expect(request.body).toBeUndefined();
    const list = tokenSummary.array().parse(data);
    expect(list.map((token) => token.name)).toContain('control');
  });

  let mintedId: number;

  test('POST /auth/tokens sends a name the input schema accepts and answers a strict created token', async () => {
    const { request, data } = await observe(() => client.createToken('contract'));
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/auth/tokens');
    expect(request.headers.get('x-app-csrf')).toBe('1');
    expect(createTokenInput.parse(request.body)).toEqual({ name: 'contract' });
    const created = createdToken.parse(data);
    expect(created.summary.name).toBe('contract');
    mintedId = created.summary.id;
  });

  test('DELETE /auth/tokens/:id sends an id the params schema accepts and answers a strict summary', async () => {
    const { request, data } = await observe(() => client.revokeToken(mintedId));
    expect(request.method).toBe('DELETE');
    expect(request.headers.get('x-app-csrf')).toBe('1');
    expect(request.body).toBeUndefined();
    const segment = request.path.slice('/auth/tokens/'.length);
    expect(request.path.startsWith('/auth/tokens/')).toBe(true);
    expect(tokenIdParam.parse({ id: segment })).toEqual({ id: mintedId });
    const revoked = tokenSummary.parse(data);
    expect(revoked.id).toBe(mintedId);
    expect(revoked.revokedAt).not.toBeNull();
  });

  test('POST /auth/logout sends no body and answers a strict sign-in state', async () => {
    const { request, data } = await observe(() => client.logout());
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/auth/logout');
    expect(request.headers.get('x-app-csrf')).toBe('1');
    expect(request.body).toBeUndefined();
    expect(signInState.parse(data)).toEqual({ signedIn: false });
  });
});

describe('the output schemas are strict', () => {
  test('an answer carrying one extra field is refused by each output schema', () => {
    const summary = {
      id: 1,
      name: 'n',
      prefix: 'p',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    };
    expect(sessionState.safeParse({ mode: 'none', signedIn: false }).success).toBe(true);
    expect(sessionState.safeParse({ mode: 'none', signedIn: false, extra: 1 }).success).toBe(false);
    expect(signInState.safeParse({ signedIn: true, extra: 1 }).success).toBe(false);
    expect(tokenSummary.safeParse(summary).success).toBe(true);
    expect(tokenSummary.safeParse({ ...summary, extra: 1 }).success).toBe(false);
    expect(createdToken.safeParse({ token: 't', summary, extra: 1 }).success).toBe(false);
  });
});
