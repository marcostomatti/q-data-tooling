/**
 * A cookie jar for tests that talk to one service over HTTP: a `fetch` bound to a base URL that
 * keeps what each `Set-Cookie` header says and sends it back the way a browser would.
 *
 * Cookies are kept by name and path, as RFC 6265 §5.3 keys them for one host: a second
 * `Set-Cookie` of the same name and path replaces the first, and the same name on another path is
 * another cookie. A cookie is sent only to request paths under its `Path` (§5.1.4). `Max-Age=0`,
 * a negative `Max-Age` or an `Expires` in the past removes it; `Max-Age` wins over `Expires`.
 *
 * The jar reads the `Set-Cookie` of the response it is handed. A `fetch` that follows redirects
 * hands it only the last one, so a test that must see the cookies a redirect sets passes
 * `redirect: 'manual'` and follows the `Location` itself.
 *
 * @module
 */

/** One cookie as the jar holds it. */
export interface StoredCookie {
  readonly name: string
  /** As the header wrote it: the jar neither decodes nor encodes it. */
  readonly value: string
  readonly path: string
  /** Milliseconds since the epoch past which the cookie is gone; `undefined` keeps it for the jar's life. */
  readonly expiresAt: number | undefined
  readonly httpOnly: boolean
  readonly secure: boolean
  /** The `SameSite` attribute as written, or `undefined` when the header has none. */
  readonly sameSite: string | undefined
}

/** A `fetch` bound to one origin, and the cookies it has gathered there. */
export interface CookieJar {
  /** The URL every relative path resolves against. */
  readonly baseUrl: string
  /**
   * Fetches `path`, resolved against {@link CookieJar.baseUrl}, with the jar's cookies for that
   * path added to any `Cookie` header `init` carries, then stores the response's `Set-Cookie`s.
   *
   * @throws {Error} when `path` resolves to another origin than the base URL's.
   */
  fetch(path: string | URL, init?: RequestInit): Promise<Response>
  /** The value of the cookie `name` that a request to `path` (default `/`) would carry, or `undefined`. */
  get(name: string, path?: string): string | undefined
  /** Every live cookie, the longest path first. */
  cookies(): readonly StoredCookie[]
  /** Forgets every cookie. */
  clear(): void
}

/** The `fetch` the jar calls; `globalThis.fetch` unless a test injects its own. */
export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MS_PER_SECOND = 1000;

/** RFC 6265 §5.2.2: an optional `-`, then digits; anything else leaves the attribute ignored. */
const MAX_AGE_PATTERN = /^-?\d+$/;

function keyOf(name: string, path: string): string {
  return `${path}\u0000${name}`;
}

/** RFC 6265 §5.1.4: the request path up to, not including, its last `/`, or `/`. */
export function defaultPath(requestPath: string): string {
  if (!requestPath.startsWith('/')) return '/';
  const last = requestPath.lastIndexOf('/');
  return last <= 0
    ? '/'
    : requestPath.slice(0, last);
}

/** RFC 6265 §5.1.4: whether a request to `requestPath` carries a cookie set on `cookiePath`. */
export function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/** What one `Set-Cookie` header says: the cookie, or that it is removed (`expiresAt <= now`). */
export function parseSetCookie(header: string, requestPath: string, now: number): StoredCookie | undefined {
  const [pair = '', ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  // §5.2: a pair with no `=` is ignored, and so is one with an empty name.
  if (eq < 0) return undefined;
  const name = pair.slice(0, eq).trim();
  if (name === '') return undefined;
  const value = pair.slice(eq + 1).trim();

  let path: string | undefined;
  let maxAge: number | undefined;
  let expires: number | undefined;
  let httpOnly = false;
  let secure = false;
  let sameSite: string | undefined;
  for (const attribute of attributes) {
    const split = attribute.indexOf('=');
    const key = (split < 0
      ? attribute
      : attribute.slice(0, split)).trim().toLowerCase();
    const raw = split < 0
      ? ''
      : attribute.slice(split + 1).trim();
    if (key === 'path') path = raw.startsWith('/')
      ? raw
      : undefined;
    else if (key === 'max-age' && MAX_AGE_PATTERN.test(raw)) maxAge = Number(raw);
    else if (key === 'expires' && !Number.isNaN(Date.parse(raw))) expires = Date.parse(raw);
    else if (key === 'httponly') httpOnly = true;
    // Read and kept, never acted on: over plain HTTP the service sets no `Secure` attribute
    // (`wantsSecureCookie` in src/auth/cookies.ts), so the jar need not drop Secure cookies for http.
    else if (key === 'secure') secure = true;
    else if (key === 'samesite') sameSite = raw;
    // `Domain` is not read: the jar is bound to one origin and sends to no other.
  }

  const expiresAt = maxAge === undefined
    ? expires
    : now + maxAge * MS_PER_SECOND;
  return { name, value, path: path ?? defaultPath(requestPath), expiresAt, httpOnly, secure, sameSite };
}

function isLive(cookie: StoredCookie, now: number): boolean {
  return cookie.expiresAt === undefined || cookie.expiresAt > now;
}

/**
 * Makes a jar bound to `baseUrl`.
 *
 * @param baseUrl - Where relative paths resolve, such as a service's origin.
 * @param fetchImpl - The `fetch` to call; `globalThis.fetch` by default.
 * @param clock - Milliseconds since the epoch, for `Max-Age` and `Expires`; `Date.now` by default.
 */
export function createCookieJar(baseUrl: string, fetchImpl: FetchImpl = fetch, clock: () => number = Date.now): CookieJar {
  const origin = new URL(baseUrl).origin;
  let store: ReadonlyMap<string, StoredCookie> = new Map();

  const live = (): StoredCookie[] => {
    const now = clock();
    return [...store.values()]
      .filter((cookie) => isLive(cookie, now))
      .sort((a, b) => b.path.length - a.path.length);
  };

  const resolve = (path: string | URL): URL => {
    const url = new URL(path, baseUrl);
    if (url.origin !== origin) throw new Error(`the cookie jar is bound to ${origin} and does not send to ${url.origin}`);
    return url;
  };

  const forPath = (requestPath: string): StoredCookie[] => live().filter((cookie) => pathMatches(cookie.path, requestPath));

  const keep = (headers: readonly string[], requestPath: string): void => {
    const now = clock();
    const next = new Map(store);
    for (const header of headers) {
      const cookie = parseSetCookie(header, requestPath, now);
      if (cookie === undefined) continue;
      const key = keyOf(cookie.name, cookie.path);
      if (isLive(cookie, now)) next.set(key, cookie);
      else next.delete(key);
    }
    store = next;
  };

  return {
    baseUrl,
    async fetch(path, init = {}) {
      const url = resolve(path);
      const headers = new Headers(init.headers);
      const sent = forPath(url.pathname).map((cookie) => `${cookie.name}=${cookie.value}`);
      const given = headers.get('cookie');
      const cookie = [...(given === null
        ? []
        : [given]), ...sent].join('; ');
      if (cookie !== '') headers.set('cookie', cookie);
      const response = await fetchImpl(url, { ...init, headers });
      keep(response.headers.getSetCookie(), url.pathname);
      return response;
    },
    get(name, path = '/') {
      return forPath(path).find((cookie) => cookie.name === name)?.value;
    },
    cookies: live,
    clear() {
      store = new Map();
    },
  };
}
