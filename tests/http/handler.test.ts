import type { Log } from '../../src/logging.ts';
import type { NextFunction, Request, Response } from 'express';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { z, ZodError } from 'zod';

import { BulkItemError, ConflictError, describeError, NotFoundError } from '../../src/errors.ts';
import { jsonHandler } from '../../src/http/handler.ts';
import { IdSchema } from '../../src/routes/common.ts';
import { captureLog } from '../support/capture-log.ts';
import { untouchableDb } from '../support/tool-harness.ts';

import { startTestServer, type TestServer } from './harness.ts';

const db = untouchableDb();

/** The three places a field can arrive from; strict, like every schema the routes share. */
const MergeSchema = z.strictObject({ fromPath: IdSchema, fromQuery: IdSchema, fromBody: IdSchema });
const CountSchema = z.strictObject({ count: z.number().int() });
const SharedNameSchema = z.strictObject({ name: z.string() });
const ScopeSchema = z.strictObject({ itemId: IdSchema });

/** What the next call to `/throws` throws, set by the test that wants it. */
let toThrow: unknown = new Error('unset');
let calls = 0;

/** The base log every handler here is built with; a 500 is logged on it, a refusal is not. */
const { log, records } = captureLog();

/** How many records were written before the current test began. */
let recordsBefore = 0;

/** Every line logged since the current test began. */
const logged = (): readonly object[] => records.slice(recordsBefore);

/** The context each `/context` call's `run` received, in call order. */
const contexts: Array<{ readonly db: unknown; readonly log: Log }> = [];

/** The tool `/throws` mirrors, which its 500 line names. */
const THROWING_TOOL = 'probe_throw';

/** The shape of a UUID, which is what a request with no acceptable `x-request-id` is traced by. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How many `/wait` calls must have reached `run` before any of them goes on. */
const WAITERS = 2;
let waiting: Array<() => void> = [];

/** A strict schema for the label a `/wait` or `/logs` call names its line by. */
const LabelSchema = z.strictObject({ label: z.string() });

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer((app) => {
    app.post('/count', jsonHandler(CountSchema, async (args) => (calls += 1, args), db, log));
    app.post('/merge/:fromPath', jsonHandler(MergeSchema, async (args) => args, db, log));
    app.get('/merge/:fromPath', jsonHandler(MergeSchema, async (args) => args, db, log));
    app.post('/named/:name', jsonHandler(SharedNameSchema, async (args) => args, db, log));
    app.get('/named', jsonHandler(SharedNameSchema, async (args) => args, db, log));
    app.post('/nothing', jsonHandler(z.strictObject({}), async () => undefined, db, log));
    app.post(
      '/throws',
      jsonHandler(z.strictObject({}), async () => Promise.reject(toThrow), db, log, { tool: THROWING_TOOL }),
    );
    app.post('/throws-web', jsonHandler(z.strictObject({}), async () => Promise.reject(toThrow), db, log));
    app.post('/logs', jsonHandler(LabelSchema, async ({ label }, context) => {
      context.log.debug({ step: 'probe', label }, 'probed');
    }, db, log));
    app.post('/wait', jsonHandler(LabelSchema, async ({ label }, context) => {
      context.log.debug({ step: 'arrive', label }, 'arrived');
      await new Promise<void>((resume) => {
        waiting.push(resume);
        if (waiting.length < WAITERS) return;
        // The later arrival goes on first, so the two finish in the opposite order to their start.
        for (const go of waiting.toReversed()) go();
        waiting = [];
      });
      context.log.debug({ step: 'leave', label }, 'left');
      return label;
    }, db, log));
    app.post('/context', jsonHandler(z.strictObject({}), async (_args, context) => void contexts.push(context), db, log));
    app.post(
      '/scoped/:setId/items/:itemId',
      jsonHandler(
        ScopeSchema,
        async (args, { pathOnly }) => ({ args, setId: pathOnly.setId }),
        db,
        log,
        { pathOnly: { setId: IdSchema } },
      ),
    );
  });
});

beforeEach(() => {
  recordsBefore = records.length;
});

afterAll(async () => {
  await server.close();
});

/** What a test reads of one response: its status, its `x-request-id` and its body. */
interface TracedOutcome {
  readonly status: number
  readonly requestId: string | null
  readonly body: unknown
}

/** POSTs `body` to `path` with `headers`, so a test can choose the `x-request-id` it sends. */
async function send(path: string, headers: Record<string, string> = {}, body: unknown = {}): Promise<TracedOutcome> {
  const response = await fetch(`${server.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, requestId: response.headers.get('x-request-id'), body: await response.json() };
}

/** The `traceId` of every line logged since the current test began, in call order. */
const tracedIds = (): readonly unknown[] => logged().map((line) => (line as { traceId?: unknown }).traceId);

describe('jsonHandler', () => {
  test('answers 400 with the field name for a body failing its schema, and never calls run', async () => {
    const before = calls;

    const outcome = await server.request('POST', '/count', { count: 'many' });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ success: false, error: { name: 'ValidationError' } });
    const message = (outcome.body as { error: { message: string } }).error.message;
    expect(message).toContain('count');
    expect(calls).toBe(before);
  });

  test('a ZodError for caller input is a 400 that names the field, not an opaque 500', async () => {
    const outcome = await server.request('POST', '/count', {});

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain('count');
    expect(JSON.stringify(outcome.body)).not.toContain('internal error');
  });

  test('names an unrecognised field, because every shared schema is strict', async () => {
    const outcome = await server.request('POST', '/count', { count: 1, limit: 5 });

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain('limit');
  });

  test('answers 400 when the body is a JSON array rather than an object', async () => {
    const outcome = await server.request('POST', '/count', [{ count: 1 }]);

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain('object');
  });

  test('answers the success envelope, with null when run returns nothing', async () => {
    const answered = await server.request('POST', '/count', { count: 3 });
    const empty = await server.request('POST', '/nothing', {});

    expect(answered).toEqual({ status: 200, body: { success: true, data: { count: 3 } } });
    expect(empty).toEqual({ status: 200, body: { success: true, data: null } });
  });

  test('merges params, query and body before parsing, coercing the text ones', async () => {
    const outcome = await server.request('POST', '/merge/7?fromQuery=8', { fromBody: 9 });

    expect(outcome).toEqual({ status: 200, body: { success: true, data: { fromPath: 7, fromQuery: 8, fromBody: 9 } } });
  });

  test('a field named by both the path and the body is a 400, so a body cannot retarget the path', async () => {
    const outcome = await server.request('POST', '/named/from-path', { name: 'from-body' });

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain('name');
  });

  test('a field named by both the path and the query is a 400 too', async () => {
    const outcome = await server.request('POST', '/merge/7?fromPath=9&fromQuery=8', { fromBody: 9 });

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain('fromPath');
  });

  test('a field named by both the query and the body takes the body, which is the stated merge order', async () => {
    const outcome = await server.request('POST', '/merge/7?fromQuery=1', { fromQuery: 2, fromBody: 3 });

    expect(outcome.body).toEqual({ success: true, data: { fromPath: 7, fromQuery: 2, fromBody: 3 } });
  });

  test('reads a GET from the query alone, with no body', async () => {
    const outcome = await server.request('GET', '/named?name=found');

    expect(outcome.body).toEqual({ success: true, data: { name: 'found' } });
  });

  test('a path-only parameter is parsed on its own schema, kept out of the tool schema and handed to run', async () => {
    const outcome = await server.request('POST', '/scoped/4/items/9');

    expect(outcome.body).toEqual({ success: true, data: { args: { itemId: 9 }, setId: 4 } });
  });

  test('a path-only parameter that fails its schema is a 400 naming it', async () => {
    const outcome = await server.request('POST', '/scoped/four/items/9');

    expect(outcome.status).toBe(400);
    expect(JSON.stringify(outcome.body)).toContain('setId');
  });

  test('answers 404 for a NotFoundError, with the same wording describeError gives', async () => {
    toThrow = new NotFoundError('item', 12);

    const outcome = await server.request('POST', '/throws', {});

    expect(outcome).toEqual({
      status: 404,
      body: { success: false, error: { name: 'NotFoundError', message: 'item 12 does not exist' } },
    });
    expect(logged()).toEqual([]);
  });

  test('every known class is worded by describeError and mapped by statusFor', async () => {
    const cases: Array<[unknown, number]> = [
      [new ConflictError('route', 'x'), 409],
      [new BulkItemError(2, new NotFoundError('item', 5)), 400],
    ];

    for (const [error, status] of cases) {
      toThrow = error;
      const outcome = await server.request('POST', '/throws', {});
      expect(outcome.status).toBe(status);
      expect(outcome.body).toEqual({ success: false, error: describeError(error) });
    }
    expect(logged()).toEqual([]);
  });

  test('answers 500 and leaks no connection detail for an unknown error, which is logged on the server instead', async () => {
    const secret = 'LEAK-SENTINEL-4f1c';
    const thrown = new Error(`connect failed: ${secret}`, { cause: new Error(`select * from key where k = '${secret}'`) });
    toThrow = thrown;

    const outcome = await server.request('POST', '/throws', {});

    expect(outcome.status).toBe(500);
    expect(outcome.body).toEqual({ success: false, error: { name: 'InternalError', message: 'internal error' } });
    expect(JSON.stringify(outcome.body)).not.toContain('LEAK-SENTINEL');
    expect(logged()).toEqual([
      { traceId: expect.stringMatching(UUID), domain: 'Http', scope: 'handle', step: 'respond', tool: THROWING_TOOL, err: thrown, level: 'error', msg: 'request failed' },
    ]);
  });

  test('a ZodError thrown by run is the server failing, so it is a flat 500 and not a 400', async () => {
    const stored = CountSchema.safeParse({ count: 'a value read back from storage' });
    toThrow = stored.error ?? new ZodError([]);

    const outcome = await server.request('POST', '/throws', {});

    expect(outcome.status).toBe(500);
    expect(outcome.body).toEqual({ success: false, error: { name: 'InternalError', message: 'internal error' } });
    expect(logged()).toEqual([
      { traceId: expect.stringMatching(UUID), domain: 'Http', scope: 'handle', step: 'respond', tool: THROWING_TOOL, err: toThrow, level: 'error', msg: 'request failed' },
    ]);
  });

  test('run receives one context holding the database and a child of the base log bound to the trace id', async () => {
    contexts.length = 0;

    const outcome = await send('/context', { 'x-request-id': 'context-1' });

    expect(outcome.status).toBe(200);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.db).toBe(db);
    expect(contexts[0]?.log).not.toBe(log);
    contexts[0]?.log.info({}, 'from the context');
    expect(logged()).toEqual([{ traceId: 'context-1', level: 'info', msg: 'from the context' }]);
  });
});

describe('jsonHandler trace id', () => {
  test('a valid x-request-id is answered as the header and is the traceId of the line run wrote', async () => {
    const outcome = await send('/logs', { 'x-request-id': 'proof-1.A:b' }, { label: 'valid' });

    expect(outcome).toEqual({ status: 200, requestId: 'proof-1.A:b', body: { success: true, data: null } });
    expect(logged()).toEqual([{ traceId: 'proof-1.A:b', step: 'probe', label: 'valid', level: 'debug', msg: 'probed' }]);
  });

  test('a request with no x-request-id gets a new UUID, answered as the header and bound on the line', async () => {
    const first = await send('/logs', {}, { label: 'none' });
    const second = await send('/logs', {}, { label: 'none' });

    expect(first.requestId).toMatch(UUID);
    expect(second.requestId).toMatch(UUID);
    expect(second.requestId).not.toBe(first.requestId);
    expect(tracedIds()).toEqual([first.requestId, second.requestId]);
  });

  test('a 65-character id is replaced by a new UUID, while a 64-character one is kept', async () => {
    const kept = 'k'.repeat(64);
    const tooLong = 'k'.repeat(65);

    const atLimit = await send('/logs', { 'x-request-id': kept }, { label: 'limit' });
    const overLimit = await send('/logs', { 'x-request-id': tooLong }, { label: 'over' });

    expect(atLimit.requestId).toBe(kept);
    expect(overLimit.requestId).toMatch(UUID);
    expect(tracedIds()).toEqual([kept, overLimit.requestId]);
  });

  /**
   * Calls a probe handler directly with `request`, which can carry a `req.id` as it does behind
   * the chassis, the id the chassis picks before any route runs. Returns the `x-request-id` answered.
   */
  async function answeredDirectly(request: Readonly<Record<string, unknown>>): Promise<string | undefined> {
    let answered: string | undefined;
    const response = {
      setHeader: (name: string, value: string) => {
        if (name === 'x-request-id') answered = value;
        return response;
      },
      status: () => response,
      json: () => response,
    };
    const handler = jsonHandler(LabelSchema, async ({ label }, context) => {
      context.log.debug({ step: 'probe', label }, 'probed');
    }, db, log);
    const next: NextFunction = () => undefined;
    await (handler as (req: Request, res: Response, next: NextFunction) => Promise<void>)(
      { params: {}, query: {}, body: { label: 'traced' }, ...request } as unknown as Request,
      response as unknown as Response,
      next,
    );
    return answered;
  }

  test('a request the chassis already traced keeps the chassis\'s id, answered as the header and bound on the line', async () => {
    const answered = await answeredDirectly({ id: 'chassis-trace-1', headers: {} });

    expect(answered).toBe('chassis-trace-1');
    expect(tracedIds()).toEqual(['chassis-trace-1']);
  });

  test.each([
    ['a number', 42],
    ['a string holding a newline', 'chassis\ntrace'],
  ])('a chassis id that is %s is not adopted, and the header\'s id is used instead', async (_kind, id) => {
    const answered = await answeredDirectly({ id, headers: { 'x-request-id': 'from-header-1' } });

    expect(answered).toBe('from-header-1');
    expect(tracedIds()).toEqual(['from-header-1']);
  });

  test('an id holding a newline is replaced by a new UUID and never reaches the log', async () => {
    // No HTTP client or parser carries a newline in a header value (fetch throws, and Node's
    // parser answers 400), so the handler is called directly with the value a lenient proxy
    // could hand it. The control is the same call with the newline taken out, which keeps the id.
    const call = async (requestId: string): Promise<string | undefined> => {
      let answered: string | undefined;
      const response = {
        setHeader: (name: string, value: string) => {
          if (name === 'x-request-id') answered = value;
          return response;
        },
        status: () => response,
        json: () => response,
      };
      const handler = jsonHandler(LabelSchema, async ({ label }, context) => {
        context.log.debug({ step: 'probe', label }, 'probed');
      }, db, log);
      const request = { headers: { 'x-request-id': requestId }, params: {}, query: {}, body: { label: 'direct' } };
      const next: NextFunction = () => undefined;
      await (handler as (req: Request, res: Response, next: NextFunction) => Promise<void>)(
        request as unknown as Request,
        response as unknown as Response,
        next,
      );
      return answered;
    };

    const withNewline = await call('line-1\nforged: line');
    const control = await call('line-1');

    expect(withNewline).toMatch(UUID);
    expect(control).toBe('line-1');
    expect(tracedIds()).toEqual([withNewline, 'line-1']);
    expect(JSON.stringify(logged())).not.toContain('forged');
  });

  test('two concurrent requests keep their own ids on every line, though they finish in reverse order', async () => {
    const [first, second] = await Promise.all([
      send('/wait', { 'x-request-id': 'trace-first' }, { label: 'first' }),
      send('/wait', { 'x-request-id': 'trace-second' }, { label: 'second' }),
    ]);

    expect(first).toEqual({ status: 200, requestId: 'trace-first', body: { success: true, data: 'first' } });
    expect(second).toEqual({ status: 200, requestId: 'trace-second', body: { success: true, data: 'second' } });
    const lines = logged() as ReadonlyArray<{ readonly label: string; readonly step: string; readonly traceId: string }>;
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 2).map((line) => line.step)).toEqual(['arrive', 'arrive']);
    for (const line of lines) expect(line.traceId).toBe(`trace-${line.label}`);
    // Both requests were inside `run` at once: each arrived before either left.
    expect(lines.slice(2).map((line) => line.step)).toEqual(['leave', 'leave']);
  });

  test('a 500 is logged on the traced log, carrying the request\'s traceId and the tool, and answers the id', async () => {
    const thrown = new Error('disk on fire');
    toThrow = thrown;

    const outcome = await send('/throws', { 'x-request-id': 'fail-7' });

    expect(outcome.status).toBe(500);
    expect(outcome.requestId).toBe('fail-7');
    expect(logged()).toEqual([
      { traceId: 'fail-7', domain: 'Http', scope: 'handle', step: 'respond', tool: THROWING_TOOL, err: thrown, level: 'error', msg: 'request failed' },
    ]);
  });

  test('a handler built with no tool, as a webRoute is, leaves tool off its 500 line', async () => {
    const thrown = new Error('no tool here');
    toThrow = thrown;

    const outcome = await send('/throws-web', { 'x-request-id': 'web-1' });

    expect(outcome.status).toBe(500);
    expect(logged()).toEqual([{ traceId: 'web-1', domain: 'Http', scope: 'handle', step: 'respond', err: thrown, level: 'error', msg: 'request failed' }]);
    expect(Object.keys(logged()[0] ?? {})).not.toContain('tool');
  });

  test('a refused request answers its id too, and logs nothing', async () => {
    const outcome = await send('/count', { 'x-request-id': 'refused-3' }, { count: 'many' });

    expect(outcome.status).toBe(400);
    expect(outcome.requestId).toBe('refused-3');
    expect(logged()).toEqual([]);
  });
});
