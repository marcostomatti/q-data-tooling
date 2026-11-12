import { describe, expect, test } from 'bun:test';

import { Company, CompanyTicker, toCik10 } from '../../src/entities/company.ts';

/** A company before its first sync: the submissions fields are empty. */
const unsynced = {
  cik: 320193,
  cik10: '0000320193',
  ticker: 'AAPL',
  name: 'Apple Inc.',
  selected: false,
  exchanges: [],
  sic: null,
  sicDescription: null,
  category: null,
  fiscalYearEnd: null,
  filingsSyncedAt: null,
};

describe('toCik10', () => {
  test('pads a CIK to ten digits', () => {
    expect(toCik10(320193)).toBe('0000320193');
    expect(toCik10(1)).toBe('0000000001');
  });

  test('leaves a ten-digit CIK unchanged', () => {
    expect(toCik10(1234567890)).toBe('1234567890');
  });
});

describe('Company', () => {
  test('accepts a company before its first sync', () => {
    expect(Company.parse(unsynced)).toEqual(unsynced);
  });

  test('accepts a synced company', () => {
    const synced = {
      ...unsynced,
      selected: true,
      exchanges: ['Nasdaq'],
      sic: '3571',
      sicDescription: 'Electronic Computers',
      category: 'Large Accelerated Filer',
      fiscalYearEnd: '0926',
      filingsSyncedAt: '2026-11-03T13:05:15.000Z',
    };
    expect(Company.parse(synced)).toEqual(synced);
  });

  test('refuses a cik10 that is not ten characters', () => {
    expect(Company.safeParse({ ...unsynced, cik10: '320193' }).success).toBe(false);
  });

  test('refuses a fractional cik', () => {
    expect(Company.safeParse({ ...unsynced, cik: 320193.5 }).success).toBe(false);
  });

  test('refuses a missing field and a stray field', () => {
    const { selected: _selected, ...withoutSelected } = unsynced;
    expect(Company.safeParse(withoutSelected).success).toBe(false);
    expect(Company.safeParse({ ...unsynced, stray: 1 }).success).toBe(false);
  });
});

describe('CompanyTicker', () => {
  test('accepts a ticker and its cik', () => {
    expect(CompanyTicker.parse({ ticker: 'BRK.B', cik: 1067983 })).toEqual({ ticker: 'BRK.B', cik: 1067983 });
  });

  test('refuses a stray field and a text cik', () => {
    expect(CompanyTicker.safeParse({ ticker: 'AAPL', cik: 320193, name: 'Apple' }).success).toBe(false);
    expect(CompanyTicker.safeParse({ ticker: 'AAPL', cik: '320193' }).success).toBe(false);
  });
});
