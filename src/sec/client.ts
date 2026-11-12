/**
 * The one way this service reaches SEC's EDGAR API. Every request carries the `SEC_USER_AGENT`
 * value as its User-Agent, since SEC answers 403 to a request that does not declare its sender,
 * and request starts are spaced so that no more than 10 leave in any second, since SEC answers
 * 429 above that. `fetch`, the clock and the sleep are injected, so a test runs the client on a
 * stub and never reaches sec.gov.
 *
 * Every failure is a `SecRequestError` or one of its four subclasses, whose `status` is the SEC
 * status (`null` when no answer came). Their messages are fixed phrases with the status and the
 * public URL, never the User-Agent (it holds an email address) and never SEC's own body.
 *
 * @module
 */

import { SEC_USER_AGENT_VARIABLE } from './config.ts';

/** The most requests SEC accepts from one sender in a second. */
export const MAX_REQUESTS_PER_SECOND = 10;

/** The shortest gap between two request starts that keeps to `MAX_REQUESTS_PER_SECOND`. */
export const MIN_REQUEST_INTERVAL_MS = 1000 / MAX_REQUESTS_PER_SECOND;

/** How long one request waits for SEC before it is reported as a network failure. */
export const DEFAULT_SEC_TIMEOUT_MS = 15_000;

/** The host of the submissions API. */
export const SEC_DATA_ORIGIN = 'https://data.sec.gov';

/** A CIK padded with leading zeros to ten digits, as the submissions URL takes it. */
const CIK10 = /^\d{10}$/;

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

/** The part of `fetch` the client calls: one URL and its options, answered by a `Response`. */
export type SecFetch = (url: string, init: RequestInit) => Promise<Response>;

/** What the client is built from. Only `fetch` and `userAgent` are required. */
export interface SecClientOptions {
  /** The `fetch` to send with, the global one in production and a stub in tests. */
  readonly fetch: SecFetch
  /** The User-Agent to send, as `readSecUserAgent` returns it. */
  readonly userAgent: string
  /** How long one request may take, `DEFAULT_SEC_TIMEOUT_MS` when left out. */
  readonly timeoutMs?: number
  /** The clock the spacing reads, in milliseconds, `performance.now` when left out. */
  readonly now?: () => number
  /** Waits the given milliseconds, a `setTimeout` promise when left out. */
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * A request to SEC failed. `status` is SEC's HTTP status, or `null` when no answer came. A status
 * without a subclass of its own (a 500, a 503) and a 2xx whose body is not JSON are this class.
 */
export class SecRequestError extends Error {
  readonly status: number | null;
  readonly url: string;

  /**
   * @param status - SEC's status, or `null` when no answer came.
   * @param url - The public URL that was requested.
   * @param message - A fixed phrase saying what went wrong, never SEC's own text.
   * @param options - `cause` keeps the thrown value of a failed connection.
   */
  constructor(status: number | null, url: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SecRequestError';
    this.status = status;
    this.url = url;
  }
}

/** SEC answered 403, which it does to a request without a declared User-Agent. */
export class SecForbiddenError extends SecRequestError {
  /** @param url - The public URL that was requested. */
  constructor(url: string) {
    super(HTTP_FORBIDDEN, url, `SEC refused ${url} (403); check that ${SEC_USER_AGENT_VARIABLE} names an app and a contact email`);
    this.name = 'SecForbiddenError';
  }
}

/** SEC answered 404: it holds nothing at that URL, such as submissions for an unknown CIK. */
export class SecNotFoundError extends SecRequestError {
  /** @param url - The public URL that was requested. */
  constructor(url: string) {
    super(HTTP_NOT_FOUND, url, `SEC has nothing at ${url} (404)`);
    this.name = 'SecNotFoundError';
  }
}

/** SEC answered 429, which it does above 10 requests per second from one sender. */
export class SecRateLimitedError extends SecRequestError {
  /** @param url - The public URL that was requested. */
  constructor(url: string) {
    super(HTTP_TOO_MANY_REQUESTS, url, `SEC rate-limited ${url} (429); it allows ${MAX_REQUESTS_PER_SECOND} requests per second`);
    this.name = 'SecRateLimitedError';
  }
}

/** No answer came: the connection failed, or SEC did not answer within the timeout. */
export class SecNetworkError extends SecRequestError {
  /**
   * @param url - The public URL that was requested.
   * @param reason - A fixed phrase, `the connection failed` or the timeout it ran past.
   * @param options - `cause` keeps what `fetch` threw.
   */
  constructor(url: string, reason: string, options?: ErrorOptions) {
    super(null, url, `SEC could not be reached for ${url}: ${reason}`, options);
    this.name = 'SecNetworkError';
  }
}

/** The client the sync flow is handed. */
export interface SecClient {
  /**
   * Fetches a company's submissions file, `https://data.sec.gov/submissions/CIK{cik10}.json`.
   *
   * @param cik10 - The company's CIK padded to ten digits.
   * @returns The parsed JSON body, unchecked: the submissions parsers check its shape.
   * @throws {RangeError} when `cik10` is not ten digits.
   * @throws {SecRequestError} or a subclass of it when the request fails.
   */
  getSubmissions(cik10: string): Promise<unknown>
}

/**
 * The submissions URL of one company.
 *
 * @param cik10 - The company's CIK padded to ten digits.
 * @returns `https://data.sec.gov/submissions/CIK{cik10}.json`.
 * @throws {RangeError} when `cik10` is not ten digits.
 */
export function submissionsUrl(cik10: string): string {
  if (!CIK10.test(cik10)) throw new RangeError(`a submissions CIK is ten digits, got ${JSON.stringify(cik10)}`);
  return `${SEC_DATA_ORIGIN}/submissions/CIK${cik10}.json`;
}

/** The error a non-2xx answer becomes. */
function refusal(status: number, url: string): SecRequestError {
  if (status === HTTP_FORBIDDEN) return new SecForbiddenError(url);
  if (status === HTTP_NOT_FOUND) return new SecNotFoundError(url);
  if (status === HTTP_TOO_MANY_REQUESTS) return new SecRateLimitedError(url);
  return new SecRequestError(status, url, `SEC failed ${url} (${status})`);
}

/** True for what `fetch` or a body read throws when the timeout signal fires. */
function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * A gate that hands out request start times at least `MIN_REQUEST_INTERVAL_MS` apart. The slot is
 * reserved before the wait, so calls made at once queue up instead of all leaving together. A timer
 * can wake a little early, so the wait goes on until the clock reaches the slot.
 */
function createSpacer(now: () => number, sleep: (ms: number) => Promise<void>): () => Promise<void> {
  let nextFree = Number.NEGATIVE_INFINITY;
  return async () => {
    const start = Math.max(now(), nextFree);
    nextFree = start + MIN_REQUEST_INTERVAL_MS;
    for (let left = start - now(); left > 0; left = start - now()) await sleep(left);
  };
}

/**
 * Builds the SEC client. The spacing is per client, so the service builds one and shares it.
 *
 * @param options - The `fetch` and User-Agent to send with, and the optional timeout, clock and sleep.
 * @returns A client whose requests carry the User-Agent and keep to 10 per second.
 * @throws {TypeError} when `userAgent` is blank.
 */
export function createSecClient(options: SecClientOptions): SecClient {
  if (options.userAgent.trim() === '') throw new TypeError(`the SEC client needs a User-Agent; set ${SEC_USER_AGENT_VARIABLE}`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEC_TIMEOUT_MS;
  const awaitSlot = createSpacer(options.now ?? (() => performance.now()), options.sleep ?? defaultSleep);
  const headers = { 'User-Agent': options.userAgent, Accept: 'application/json' };

  async function getJson(url: string): Promise<unknown> {
    await awaitSlot();
    let response: Response;
    try {
      response = await options.fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error: unknown) {
      const reason = isTimeout(error)
        ? `it did not answer within ${timeoutMs} ms`
        : 'the connection failed';
      throw new SecNetworkError(url, reason, { cause: error });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw refusal(response.status, url);
    }
    try {
      return await response.json();
    } catch (error: unknown) {
      if (isTimeout(error)) throw new SecNetworkError(url, `it did not answer within ${timeoutMs} ms`, { cause: error });
      throw new SecRequestError(response.status, url, `SEC answered ${url} with a body that is not JSON`);
    }
  }

  // Async, so a bad CIK rejects like every other failure instead of throwing at the call.
  return { getSubmissions: async (cik10) => getJson(submissionsUrl(cik10)) };
}
