import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';

import {
  BulkItemError,
  ConflictError,
  describeError,
  NotFoundError,
  statusFor,
} from '../src/errors.ts';
import { errorResult } from '../src/mcp/result.ts';
import {
  SecForbiddenError,
  SecNetworkError,
  SecNotFoundError,
  SecRateLimitedError,
  SecRequestError,
} from '../src/sec/client.ts';

const SEC_URL = 'https://data.sec.gov/submissions/CIK0000320193.json';

function textOf(result: ReturnType<typeof errorResult>): string {
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('expected a text block');
  return first.text;
}

describe('statusFor', () => {
  test('statusFor maps each error class to its status', () => {
    expect(statusFor(new NotFoundError('item', 7))).toBe(404);
    expect(statusFor(new ConflictError('item_key', 'acme-dev'))).toBe(409);
    expect(statusFor(new BulkItemError(2, new Error('boom')))).toBe(400);
    expect(statusFor(new ZodError([]))).toBe(400);
  });

  test('statusFor maps a subclass of ConflictError to 409, as it does the class itself', () => {
    class DuplicateWidgetError extends ConflictError {
      constructor() {
        super('widget', 'w-1');
        this.name = 'DuplicateWidgetError';
      }
    }

    expect(statusFor(new DuplicateWidgetError())).toBe(409);
  });

  test('statusFor sends every SEC failure to 502, whatever SEC answered or when it did not answer', () => {
    expect(statusFor(new SecForbiddenError(SEC_URL))).toBe(502);
    expect(statusFor(new SecNotFoundError(SEC_URL))).toBe(502);
    expect(statusFor(new SecRateLimitedError(SEC_URL))).toBe(502);
    expect(statusFor(new SecNetworkError(SEC_URL, 'the connection failed'))).toBe(502);
    expect(statusFor(new SecRequestError(503, SEC_URL, `SEC failed ${SEC_URL} (503)`))).toBe(502);
  });

  test('statusFor sends an unknown error to 500', () => {
    expect(statusFor(new Error('connection refused'))).toBe(500);
  });

  test('statusFor sends a thrown non-Error value to 500', () => {
    expect(statusFor('postgres://user:secret@host/db')).toBe(500);
  });
});

describe('error messages', () => {
  test('NotFoundError names the entity and the id without a query', () => {
    const error = new NotFoundError('item', 7);
    expect(error.message).toBe('item 7 does not exist');
    expect(error.message).not.toContain('select');
  });

  test('NotFoundError may carry the driver fault on cause and keeps it out of the message', () => {
    const cause = new Error('insert into "origin" violates a foreign key');
    const error = new NotFoundError('item', 7, { cause });
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('item 7 does not exist');
  });

  test('ConflictError takes its own message, keeps the cause off it, and still names the field and key', () => {
    const cause = new Error('driver detail');
    const error = new ConflictError('item set', '3', { message: 'an entry names an item outside it', cause });
    expect(error.message).toBe('an entry names an item outside it');
    expect(error.cause).toBe(cause);
    expect(error).toMatchObject({ field: 'item set', key: '3', name: 'ConflictError' });
    expect(statusFor(error)).toBe(409);
    expect(new ConflictError('a', 'b').message).toBe('a b already exists');
    expect('cause' in new ConflictError('a', 'b')).toBe(false);
  });

  test('ConflictError names the key and not the cause', () => {
    const error = new ConflictError('item_key', 'acme-dev');
    expect(error.message).toBe('item_key acme-dev already exists');
    expect(error.name).toBe('ConflictError');
  });

  test('BulkItemError reports the index and keeps the cause out of the message', () => {
    const cause = new Error('connection refused');
    const error = new BulkItemError(2, cause);
    expect(error.index).toBe(2);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('bulk item 2 failed');
    expect(error.message).not.toContain(cause.message);
    expect(error.name).toBe('BulkItemError');
  });
});

describe('describeError', () => {
  test('describeError returns the same name and message errorResult puts in its envelope', () => {
    const error = new BulkItemError(4, new NotFoundError('route', 3));

    const described = describeError(error);

    expect(described).toEqual({ name: 'BulkItemError', message: 'bulk item 4 failed: route 3 does not exist' });
    expect(JSON.parse(textOf(errorResult(error)))).toEqual({ error: described });
  });

  test('describeError shows an SEC failure\'s name and its message with the SEC status, and never its cause', () => {
    const error = new SecNetworkError(SEC_URL, 'the connection failed', { cause: new Error('getaddrinfo ENOTFOUND data.sec.gov') });

    expect(describeError(new SecForbiddenError(SEC_URL))).toEqual({ name: 'SecForbiddenError', message: new SecForbiddenError(SEC_URL).message });
    expect(describeError(new SecForbiddenError(SEC_URL)).message).toContain('(403)');
    expect(describeError(error)).toEqual({ name: 'SecNetworkError', message: `SEC could not be reached for ${SEC_URL}: the connection failed` });
  });

  test('describeError returns the flat internal error for an unknown error', () => {
    expect(describeError(new Error('connect ECONNREFUSED on port 5439'))).toEqual({
      name: 'InternalError',
      message: 'internal error',
    });
  });
});
