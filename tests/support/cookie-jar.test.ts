import type { FetchImpl } from './cookie-jar.ts';
import type { Server } from 'bun';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createCookieJar, defaultPath, parseSetCookie, pathMatches } from './cookie-jar.ts';

/**
 * A server that answers every request with the `Cookie` header it received as its body, and
 * sets one `Set-Cookie` per `set` query parameter, exactly as written.
 */
let server: Server<undefined>;
let origin = '';

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const headers = new Headers();
      for (const header of url.searchParams.getAll('set')) headers.append('set-cookie', header);
      return new Response(request.headers.get('cookie') ?? '', { headers });
    },
  });
  origin = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.stop(true);
});

/** A path that makes the server set each of `headers`. */
function setting(path: string, ...headers: string[]): string {
  const query = new URLSearchParams(headers.map((header) => ['set', header]));
  return `${path}?${query.toString()}`;
}

/** What the server saw in `Cookie` for a request to `path`. */
async function sentTo(jar: ReturnType<typeof createCookieJar>, path: string): Promise<string> {
  return (await jar.fetch(path)).text();
}

describe('createCookieJar against a real server', () => {
  test('resolves a relative path against the base URL and sends no cookie before one is set', async () => {
    const jar = createCookieJar(`${origin}/`);

    const response = await jar.fetch('/anything');

    expect(response.url).toBe(`${origin}/anything`);
    expect(await response.text()).toBe('');
  });

  test('sends a stored cookie back on a later request', async () => {
    const jar = createCookieJar(origin);

    await jar.fetch(setting('/', 'sid=abc; Path=/; HttpOnly; SameSite=Lax'));

    expect(await sentTo(jar, '/next')).toBe('sid=abc');
  });

  test('a cookie is not sent outside its path', async () => {
    const jar = createCookieJar(origin);
    await jar.fetch(setting('/', 'scoped=1; Path=/auth'));

    // Control: the same jar does send it under its path, so the empty readings below can fail.
    expect(await sentTo(jar, '/auth')).toBe('scoped=1');
    expect(await sentTo(jar, '/auth/login')).toBe('scoped=1');
    expect(await sentTo(jar, '/api/info')).toBe('');
    expect(await sentTo(jar, '/authority')).toBe('');
    expect(await sentTo(jar, '/')).toBe('');
  });

  test('Max-Age=0 removes the cookie', async () => {
    const jar = createCookieJar(origin);
    await jar.fetch(setting('/', 'sid=abc; Path=/; Max-Age=3600'));
    // Control: the cookie is held before the removal.
    expect(await sentTo(jar, '/')).toBe('sid=abc');

    await jar.fetch(setting('/', 'sid=; Path=/; Max-Age=0'));

    expect(await sentTo(jar, '/')).toBe('');
    expect(jar.cookies()).toEqual([]);
  });

  test('Max-Age=0 on another path leaves the cookie of the same name alone', async () => {
    const jar = createCookieJar(origin);
    await jar.fetch(setting('/', 'sid=abc; Path=/'));

    await jar.fetch(setting('/', 'sid=; Path=/auth; Max-Age=0'));

    expect(await sentTo(jar, '/')).toBe('sid=abc');
  });

  test('a second Set-Cookie of the same name and path replaces the first', async () => {
    const jar = createCookieJar(origin);
    await jar.fetch(setting('/', 'sid=first; Path=/'));

    await jar.fetch(setting('/', 'sid=second; Path=/'));

    expect(await sentTo(jar, '/')).toBe('sid=second');
    expect(jar.cookies().map((cookie) => cookie.value)).toEqual(['second']);
  });

  test('the same name on another path is another cookie, the longer path sent first', async () => {
    const jar = createCookieJar(origin);

    await jar.fetch(setting('/', 'sid=root; Path=/', 'sid=auth; Path=/auth'));

    expect(await sentTo(jar, '/auth/me')).toBe('sid=auth; sid=root');
    expect(await sentTo(jar, '/api')).toBe('sid=root');
  });

  test('adds its cookies to a Cookie header the caller gives', async () => {
    const jar = createCookieJar(origin);
    await jar.fetch(setting('/', 'sid=abc; Path=/'));

    const response = await jar.fetch('/', { headers: { cookie: 'forged=1' } });

    expect(await response.text()).toBe('forged=1; sid=abc');
  });

  test('refuses a URL on another origin', async () => {
    const jar = createCookieJar(origin);

    await expect(jar.fetch('http://example.invalid/')).rejects.toThrow('does not send to http://example.invalid');
  });
});

describe('createCookieJar with an injected fetch and clock', () => {
  test('a cookie past its Max-Age is no longer sent', async () => {
    let now = 1_000_000;
    const seen: string[] = [];
    const fake: FetchImpl = (_input, init) => {
      seen.push(new Headers(init?.headers).get('cookie') ?? '');
      return Promise.resolve(new Response('', { headers: { 'set-cookie': 'short=1; Path=/; Max-Age=10' } }));
    };
    const jar = createCookieJar('http://localhost:1', fake, () => now);
    await jar.fetch('/');

    now += 9_000;
    expect(jar.get('short')).toBe('1');
    now += 1_000;
    expect(jar.get('short')).toBeUndefined();
  });

  test('an Expires in the past removes the cookie, and Max-Age wins over Expires', async () => {
    const headers = ['a=1; Path=/', 'b=1; Path=/', 'a=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT', 'b=2; Path=/; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
    const fake: FetchImpl = () => {
      const response = new Headers();
      for (const header of headers) response.append('set-cookie', header);
      return Promise.resolve(new Response('', { headers: response }));
    };
    const jar = createCookieJar('http://localhost:1', fake);

    await jar.fetch('/');

    expect(jar.get('a')).toBeUndefined();
    expect(jar.get('b')).toBe('2');
  });
});

describe('the Set-Cookie reading', () => {
  test('parses the attributes the service writes', () => {
    const cookie = parseSetCookie('template-service_session=a%2Fb; Path=/; Max-Age=60; HttpOnly; SameSite=Lax', '/auth/login', 0);

    expect(cookie).toEqual({
      name: 'template-service_session',
      value: 'a%2Fb',
      path: '/',
      expiresAt: 60_000,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    });
  });

  test('ignores a pair with no = or no name, and a Max-Age that is not a number', () => {
    expect(parseSetCookie('novalue', '/', 0)).toBeUndefined();
    expect(parseSetCookie('=x', '/', 0)).toBeUndefined();
    expect(parseSetCookie('a=1; Max-Age=soon', '/', 0)?.expiresAt).toBeUndefined();
  });

  test('a missing or relative Path takes the default path of the request', () => {
    expect(parseSetCookie('a=1', '/auth/login', 0)?.path).toBe('/auth');
    expect(parseSetCookie('a=1; Path=auth', '/auth/login', 0)?.path).toBe('/auth');
    expect(defaultPath('/login')).toBe('/');
    expect(defaultPath('')).toBe('/');
  });

  test('path matching follows RFC 6265', () => {
    expect(pathMatches('/auth', '/auth')).toBe(true);
    expect(pathMatches('/auth', '/auth/me')).toBe(true);
    expect(pathMatches('/auth/', '/auth/me')).toBe(true);
    expect(pathMatches('/auth', '/authority')).toBe(false);
    expect(pathMatches('/auth', '/')).toBe(false);
  });
});
