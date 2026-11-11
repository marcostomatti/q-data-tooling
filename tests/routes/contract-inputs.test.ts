import type { z } from 'zod';

import { describe, expect, test } from 'bun:test';

import { CompanyListInput, CompanyUpdateInput } from '../../src/routes/companies/contract.ts';
import { FilingListInput, SummaryInput } from '../../src/routes/filings/contract.ts';

type InputCase = {
  name: string;
  schema: z.ZodType;
  valid: Record<string, unknown>;
  hasTicker: boolean;
  hasForm: boolean;
  hasPaging: boolean;
};

const CASES: InputCase[] = [
  { name: 'CompanyListInput', schema: CompanyListInput, valid: {}, hasTicker: false, hasForm: false, hasPaging: true },
  { name: 'CompanyUpdateInput', schema: CompanyUpdateInput, valid: { ticker: 'aapl', selected: true }, hasTicker: true, hasForm: false, hasPaging: false },
  { name: 'FilingListInput', schema: FilingListInput, valid: { ticker: 'aapl' }, hasTicker: true, hasForm: true, hasPaging: true },
  { name: 'SummaryInput', schema: SummaryInput, valid: {}, hasTicker: false, hasForm: true, hasPaging: true },
];

const MALFORMED_TICKERS = ['', 'TOOLONGTICKER', 'AA PL', 'AAPL!', '../x', 'ÅAPL'];

describe.each(CASES)('$name', ({ schema, valid, hasTicker, hasForm, hasPaging }) => {
  test('accepts its valid baseline', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  test('refuses a stray field', () => {
    expect(schema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  test.if(hasTicker)('refuses a malformed ticker', () => {
    for (const ticker of MALFORMED_TICKERS) {
      expect(schema.safeParse({ ...valid, ticker }).success).toBe(false);
    }
    expect(schema.safeParse({ ...valid, ticker: 123 }).success).toBe(false);
  });

  test.if(hasForm)('refuses an unknown form', () => {
    for (const form of ['10-K/A', 'S-1', '10k', '']) {
      expect(schema.safeParse({ ...valid, form }).success).toBe(false);
    }
    expect(schema.safeParse({ ...valid, form: '10-Q' }).success).toBe(true);
  });

  test.if(hasPaging)('refuses page 0 and pageSize 101, as numbers and as text', () => {
    for (const bad of [{ page: 0 }, { page: '0' }, { pageSize: 101 }, { pageSize: '101' }, { pageSize: 0 }]) {
      expect(schema.safeParse({ ...valid, ...bad }).success).toBe(false);
    }
    expect(schema.safeParse({ ...valid, page: 1, pageSize: 100 }).success).toBe(true);
  });
});

describe('CompanyUpdateInput body', () => {
  test('refuses a body without selected', () => {
    expect(CompanyUpdateInput.safeParse({ ticker: 'AAPL' }).success).toBe(false);
  });

  test('refuses a selected that is not a boolean', () => {
    for (const selected of ['true', 1, null]) {
      expect(CompanyUpdateInput.safeParse({ ticker: 'AAPL', selected }).success).toBe(false);
    }
  });

  test('upper cases the ticker', () => {
    expect(CompanyUpdateInput.parse({ ticker: 'aapl', selected: false })).toEqual({ ticker: 'AAPL', selected: false });
  });
});
