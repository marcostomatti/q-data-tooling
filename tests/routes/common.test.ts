import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  pageOf,
  PaginationQuery,
  Ticker,
} from '../../src/routes/common.ts';

describe('Ticker', () => {
  test('accepts lower case and returns upper case', () => {
    expect(Ticker.parse('aapl')).toBe('AAPL');
    expect(Ticker.parse('brk.b')).toBe('BRK.B');
    expect(Ticker.parse('Bf-a')).toBe('BF-A');
  });

  test('returns an upper-case ticker unchanged', () => {
    expect(Ticker.parse('MSFT')).toBe('MSFT');
  });

  test('refuses an empty, overlong or malformed ticker', () => {
    expect(Ticker.safeParse('').success).toBe(false);
    expect(Ticker.safeParse('ABCDEFGHIJK').success).toBe(false);
    expect(Ticker.safeParse('AA PL').success).toBe(false);
    expect(Ticker.safeParse('AAPL/').success).toBe(false);
  });

  test('accepts a ticker of exactly ten characters', () => {
    expect(Ticker.parse('abcdefghij')).toBe('ABCDEFGHIJ');
  });
});

describe('PaginationQuery', () => {
  test('defaults page to 1 and pageSize to PAGE_SIZE_DEFAULT', () => {
    expect(PaginationQuery.parse({})).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT });
    expect(PAGE_SIZE_DEFAULT).toBe(25);
  });

  test('takes numbers from MCP and digits from a query string', () => {
    expect(PaginationQuery.parse({ page: 3, pageSize: 50 })).toEqual({ page: 3, pageSize: 50 });
    expect(PaginationQuery.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  test('accepts pageSize up to PAGE_SIZE_MAX and refuses one past it', () => {
    expect(PAGE_SIZE_MAX).toBe(100);
    expect(PaginationQuery.parse({ pageSize: PAGE_SIZE_MAX }).pageSize).toBe(PAGE_SIZE_MAX);
    expect(PaginationQuery.safeParse({ pageSize: PAGE_SIZE_MAX + 1 }).success).toBe(false);
  });

  test('refuses page 0, pageSize 0, a fraction, non-digit text and a stray field', () => {
    expect(PaginationQuery.safeParse({ page: 0 }).success).toBe(false);
    expect(PaginationQuery.safeParse({ pageSize: 0 }).success).toBe(false);
    expect(PaginationQuery.safeParse({ page: 1.5 }).success).toBe(false);
    expect(PaginationQuery.safeParse({ page: 'two' }).success).toBe(false);
    expect(PaginationQuery.safeParse({ page: true }).success).toBe(false);
    expect(PaginationQuery.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('pageOf', () => {
  const Page = pageOf(z.strictObject({ id: z.number() }));

  test('accepts a page of items with its paging fields', () => {
    const page = { items: [{ id: 1 }, { id: 2 }], page: 1, pageSize: 25, total: 2 };
    expect(Page.parse(page)).toEqual(page);
  });

  test('refuses an item off the item schema, a missing total and a stray field', () => {
    expect(Page.safeParse({ items: [{ id: 'x' }], page: 1, pageSize: 25, total: 1 }).success).toBe(false);
    expect(Page.safeParse({ items: [], page: 1, pageSize: 25 }).success).toBe(false);
    expect(Page.safeParse({ items: [], page: 1, pageSize: 25, total: 0, extra: true }).success).toBe(false);
  });
});
