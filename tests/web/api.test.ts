import { describe, expect, test } from 'bun:test';

import { ApiError, auth, createAuthClient, request, type SessionState } from '../../src/web/api.ts';

interface Call {
  readonly path: string
  readonly init: RequestInit
}

/** A `fetch` stand-in that records each call and answers with the given body and status. */
function stubFetch(body: string, status = 200): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ path: String(input), init: init ?? {} });
    return new Response(body, { status });
  };
  return { fetchImpl: impl as typeof fetch, calls };
}

const OK = JSON.stringify({ success: true, data: { id: 7 } });

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('request', () => {
  test('a success envelope unwraps data', async () => {
    const { fetchImpl } = stubFetch(OK);
    expect(await request('GET', '/x', undefined, fetchImpl)).toEqual({ id: 7 });
  });

  test('a failure envelope throws ApiError with its name and message', async () => {
    const failure = { success: false, error: { name: 'Forbidden', message: 'no' } };
    const { fetchImpl } = stubFetch(JSON.stringify(failure), 403);
    const error = await caught(request('POST', '/x', undefined, fetchImpl));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).errorName).toBe('Forbidden');
    expect((error as ApiError).message).toBe('no');
  });

  test('a non-JSON body throws ApiError with the status', async () => {
    const { fetchImpl } = stubFetch('<html>bad gateway</html>', 502);
    const error = await caught(request('GET', '/x', undefined, fetchImpl));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toContain('502');
  });

  test('x-app-csrf is sent on non-GET only', async () => {
    const { fetchImpl, calls } = stubFetch(OK);
    await request('GET', '/x', undefined, fetchImpl);
    await request('POST', '/x', undefined, fetchImpl);
    await request('DELETE', '/x', undefined, fetchImpl);
    expect(headersOf(calls[0])['x-app-csrf']).toBeUndefined();
    expect(headersOf(calls[1])['x-app-csrf']).toBe('1');
    expect(headersOf(calls[2])['x-app-csrf']).toBe('1');
  });

  test('content-type: application/json is sent only with a body', async () => {
    const { fetchImpl, calls } = stubFetch(OK);
    await request('POST', '/x', undefined, fetchImpl);
    await request('POST', '/x', { a: 1 }, fetchImpl);
    expect(headersOf(calls[0])['content-type']).toBeUndefined();
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headersOf(calls[1])['content-type']).toBe('application/json');
    expect(calls[1]?.init.body).toBe('{"a":1}');
  });
});

describe('createAuthClient', () => {
  test('each call goes through the given fetchImpl, with its method, path and body', async () => {
    const { fetchImpl, calls } = stubFetch(OK);
    const client = createAuthClient(fetchImpl);
    await client.session();
    await client.login('hunter2');
    await client.logout();
    await client.listTokens();
    await client.createToken('ci');
    await client.revokeToken(7);
    expect(calls.map((call) => `${call.init.method} ${call.path}`)).toEqual([
      'GET /auth/session',
      'POST /auth/login',
      'POST /auth/logout',
      'GET /auth/tokens',
      'POST /auth/tokens',
      'DELETE /auth/tokens/7',
    ]);
    expect(calls[1]?.init.body).toBe('{"password":"hunter2"}');
    expect(calls[4]?.init.body).toBe('{"name":"ci"}');
  });

  test('a call answers with the data its fetchImpl returned', async () => {
    const state: SessionState = { mode: 'password', signedIn: true };
    const { fetchImpl } = stubFetch(JSON.stringify({ success: true, data: state }));
    expect(await createAuthClient(fetchImpl).session()).toEqual(state);
  });

  test('a second fetchImpl is not reached by the first client', async () => {
    const first = stubFetch(OK);
    const second = stubFetch(OK);
    createAuthClient(second.fetchImpl);
    await createAuthClient(first.fetchImpl).session();
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });

  test('auth carries the same calls as a created client', () => {
    expect(Object.keys(auth).sort()).toEqual(Object.keys(createAuthClient(fetch)).sort());
  });
});
