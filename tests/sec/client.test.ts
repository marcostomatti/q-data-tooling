import { describe, expect, test } from 'bun:test';

import {
  createSecClient,
  MAX_REQUESTS_PER_SECOND,
  MIN_REQUEST_INTERVAL_MS,
  type SecClient,
  type SecFetch,
  SecForbiddenError,
  SecNetworkError,
  SecNotFoundError,
  SecRateLimitedError,
  SecRequestError,
  submissionsUrl,
} from '../../src/sec/client.ts';

/** A made-up value at a reserved domain, in the form SEC asks for. */
const USER_AGENT = 'q-data-tooling tests tests@example.com';

/** A CIK no SEC company holds, so a stray live answer could not match the stub's. */
const CIK10 = '0000000042';

/** A body a real submissions file cannot hold, so a live answer is visible on sight. */
const STUB_BODY = { cik: CIK10, name: 'stub-company-1' };

/** One request the stub saw: its URL, its User-Agent and the clock when it arrived. */
interface SeenRequest {
  readonly url: string
  readonly userAgent: string | null
  readonly at: number
}

/** A stub `fetch` that records every request and answers with what `answer` returns. */
function stubFetch(clock: () => number, answer: () => Response | Promise<Response> = () => Response.json(STUB_BODY)) {
  const requests: SeenRequest[] = [];
  const fetch: SecFetch = async (url, init) => {
    requests.push({ url, userAgent: new Headers(init.headers).get('user-agent'), at: clock() });
    return answer();
  };
  return { fetch, requests };
}

/**
 * A clock that moves only when the test drains it: `sleep` parks a timer, and `run` fires the
 * timers in time order until the work settles, so a spacing test takes no real time.
 */
function fakeClock() {
  let time = 0;
  let timers: { readonly at: number; readonly resolve: () => void }[] = [];
  const now = (): number => time;
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
    timers = [...timers, { at: time + ms, resolve }];
  });
  const run = async <T>(work: Promise<T>): Promise<T> => {
    let settled = false;
    const observed = work.finally(() => {
      settled = true;
    });
    observed.catch(() => undefined);
    while (!settled) {
      await new Promise((resolve) => setImmediate(resolve));
      const [next, ...rest] = [...timers].sort((left, right) => left.at - right.at);
      if (next !== undefined) {
        timers = rest;
        time = next.at;
        next.resolve();
      }
    }
    return work;
  };
  return { now, sleep, run };
}

/** The most request starts that fall in any one-second window. */
function mostInAnySecond(times: readonly number[]): number {
  return Math.max(0, ...times.map((start) => times.filter((at) => at >= start && at < start + 1000).length));
}

/** What `promise` rejected with, or `undefined` when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => undefined, (error: unknown) => error);
}

/** A client on a fake clock and a stub `fetch` that answers every request with `answer`. */
function clientAnswering(answer: () => Response | Promise<Response>) {
  const clock = fakeClock();
  const stub = stubFetch(clock.now, answer);
  const client: SecClient = createSecClient({ fetch: stub.fetch, userAgent: USER_AGENT, now: clock.now, sleep: clock.sleep });
  return { clock, stub, client };
}

describe('submissionsUrl', () => {
  test('builds the submissions URL from a ten-digit CIK', () => {
    expect(submissionsUrl('0000320193')).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
  });

  test.each(['320193', '00003201930', '000032019a', ''])('refuses %p, which is not ten digits', (cik10) => {
    expect(() => submissionsUrl(cik10)).toThrow(RangeError);
  });
});

describe('createSecClient', () => {
  test('refuses a blank User-Agent', () => {
    const { fetch } = stubFetch(() => 0);
    expect(() => createSecClient({ fetch, userAgent: ' \t' })).toThrow(TypeError);
  });

  test('sends the User-Agent to the submissions URL through the injected fetch', async () => {
    const { clock, stub, client } = clientAnswering(() => Response.json(STUB_BODY));
    const body = await clock.run(client.getSubmissions(CIK10));
    expect(stub.requests.length).toBeGreaterThan(0);
    expect(stub.requests).toEqual([{ url: `https://data.sec.gov/submissions/CIK${CIK10}.json`, userAgent: USER_AGENT, at: 0 }]);
    expect(body).toEqual(STUB_BODY);
  });

  test('sends nothing for a CIK that is not ten digits', async () => {
    const { clock, stub, client } = clientAnswering(() => Response.json(STUB_BODY));
    expect(await clock.run(rejection(client.getSubmissions('42')))).toBeInstanceOf(RangeError);
    expect(stub.requests).toEqual([]);
  });
});

describe('the request spacing', () => {
  test('the window count can fail: unspaced starts count over the limit', () => {
    const unspaced = Array.from({ length: MAX_REQUESTS_PER_SECOND + 1 }, () => 0);
    expect(mostInAnySecond(unspaced)).toBe(MAX_REQUESTS_PER_SECOND + 1);
  });

  test('25 requests made at once start 100 ms apart, never more than 10 in a second', async () => {
    const { clock, stub, client } = clientAnswering(() => Response.json(STUB_BODY));
    const count = 25;
    await clock.run(Promise.all(Array.from({ length: count }, () => client.getSubmissions(CIK10))));
    const starts = stub.requests.map((request) => request.at);
    expect(starts).toHaveLength(count);
    expect(starts).toEqual(Array.from({ length: count }, (_, index) => index * MIN_REQUEST_INTERVAL_MS));
    expect(mostInAnySecond(starts)).toBe(MAX_REQUESTS_PER_SECOND);
  });

  test('a request after a long pause leaves at once', async () => {
    const { clock, stub, client } = clientAnswering(() => Response.json(STUB_BODY));
    await clock.run(client.getSubmissions(CIK10));
    await clock.run(clock.sleep(5_000));
    await clock.run(client.getSubmissions(CIK10));
    expect(stub.requests.map((request) => request.at)).toEqual([0, 5_000]);
  });

  test('a failed request still holds its slot', async () => {
    const { clock, stub, client } = clientAnswering(() => new Response(null, { status: 429 }));
    await clock.run(Promise.all([rejection(client.getSubmissions(CIK10)), rejection(client.getSubmissions(CIK10))]));
    expect(stub.requests.map((request) => request.at)).toEqual([0, MIN_REQUEST_INTERVAL_MS]);
  });

  test('a sleep that wakes early is topped up, so no request starts early', async () => {
    const clock = fakeClock();
    // Wakes 2 ms short of what was asked, as a real timer can, and on time for a short wait.
    const sleep = (ms: number): Promise<void> => clock.sleep(ms > 2
      ? ms - 2
      : ms);
    const stub = stubFetch(clock.now);
    const client = createSecClient({ fetch: stub.fetch, userAgent: USER_AGENT, now: clock.now, sleep });
    await clock.run(Promise.all([client.getSubmissions(CIK10), client.getSubmissions(CIK10), client.getSubmissions(CIK10)]));
    expect(stub.requests.map((request) => request.at)).toEqual([0, MIN_REQUEST_INTERVAL_MS, 2 * MIN_REQUEST_INTERVAL_MS]);
  });

  test('the default clock and sleep space real requests too', async () => {
    const stub = stubFetch(() => performance.now());
    const client = createSecClient({ fetch: stub.fetch, userAgent: USER_AGENT });
    await Promise.all([client.getSubmissions(CIK10), client.getSubmissions(CIK10), client.getSubmissions(CIK10)]);
    const [first, second, third] = stub.requests.map((request) => request.at);
    expect(stub.requests).toHaveLength(3);
    // A timer may fire a millisecond early against `performance.now`, so the floor allows that.
    expect((second ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS - 2);
    expect((third ?? 0) - (second ?? 0)).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS - 2);
  });
});

describe('the error mapping', () => {
  test.each([
    [403, SecForbiddenError, 'SEC_USER_AGENT'],
    [404, SecNotFoundError, '(404)'],
    [429, SecRateLimitedError, '10 requests per second'],
    [500, SecRequestError, '(500)'],
  ] as const)('a %i is a %p carrying the status', async (status, errorClass, phrase) => {
    const { clock, stub, client } = clientAnswering(() => new Response('secret internals', { status }));
    const error = await clock.run(rejection(client.getSubmissions(CIK10)));
    expect(stub.requests).toHaveLength(1);
    expect(error).toBeInstanceOf(errorClass);
    expect(error).toBeInstanceOf(SecRequestError);
    expect(error).toMatchObject({ status, url: submissionsUrl(CIK10), name: errorClass.name });
    const { message } = error as Error;
    expect(message).toContain(phrase);
    expect(message).not.toContain('secret internals');
    expect(message).not.toContain(USER_AGENT);
  });

  test('a 500 is the base class only, not one of the named statuses', async () => {
    const { clock, client } = clientAnswering(() => new Response(null, { status: 500 }));
    const error = await clock.run(rejection(client.getSubmissions(CIK10)));
    expect(error).not.toBeInstanceOf(SecForbiddenError);
    expect(error).not.toBeInstanceOf(SecNotFoundError);
    expect(error).not.toBeInstanceOf(SecRateLimitedError);
    expect(error).not.toBeInstanceOf(SecNetworkError);
  });

  test('a failed connection is a network error with no status and the cause kept', async () => {
    const thrown = new TypeError('fetch failed: connect ECONNREFUSED');
    const { clock, stub, client } = clientAnswering(() => Promise.reject(thrown));
    const error = await clock.run(rejection(client.getSubmissions(CIK10)));
    expect(stub.requests).toHaveLength(1);
    expect(error).toBeInstanceOf(SecNetworkError);
    expect(error).toMatchObject({ status: null, cause: thrown });
    expect((error as Error).message).toContain('the connection failed');
    expect((error as Error).message).not.toContain('ECONNREFUSED');
  });

  test('a timeout is a network error that names the timeout', async () => {
    const clock = fakeClock();
    const stub = stubFetch(clock.now, () => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    const client = createSecClient({ fetch: stub.fetch, userAgent: USER_AGENT, timeoutMs: 250, now: clock.now, sleep: clock.sleep });
    const error = await clock.run(rejection(client.getSubmissions(CIK10)));
    expect(error).toBeInstanceOf(SecNetworkError);
    expect((error as Error).message).toContain('within 250 ms');
  });

  test('a 200 whose body is not JSON is a request error with its status', async () => {
    const { clock, client } = clientAnswering(() => new Response('<html>maintenance</html>', { status: 200 }));
    const error = await clock.run(rejection(client.getSubmissions(CIK10)));
    expect(error).toBeInstanceOf(SecRequestError);
    expect(error).not.toBeInstanceOf(SecNetworkError);
    expect(error).toMatchObject({ status: 200 });
    expect((error as Error).message).not.toContain('maintenance');
  });
});
