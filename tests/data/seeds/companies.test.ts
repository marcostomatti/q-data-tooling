import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { chunked, SEED_CHUNK_SIZE, TickerFile, TICKERS_FILE, toSeedRows } from '../../../src/data/seeds/01-companies.ts';

// `seedTickers` and `seed` write to a database, in tests/integration/data/seeds/companies.test.ts.

/** A small ticker list shaped like the SEC file: a company with two tickers and one with one. */
const TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 2809, ticker: 'AEM', title: 'AGNICO EAGLE MINES LTD' },
  '2': { cik_str: 2809, ticker: 'AEMRF', title: 'AGNICO EAGLE MINES LTD' },
};

describe('TickerFile', () => {
  test('accepts the SEC shape', () => {
    expect(TickerFile.parse(TICKERS)).toEqual(TICKERS);
  });

  test('refuses a cik_str that is a string', () => {
    expect(TickerFile.safeParse({ '0': { ...TICKERS['0'], cik_str: '320193' } }).success).toBe(false);
  });

  test('refuses an entry without a title', () => {
    expect(TickerFile.safeParse({ '0': { cik_str: 320193, ticker: 'AAPL' } }).success).toBe(false);
  });
});

describe('toSeedRows', () => {
  test('one company per CIK, the first ticker as primary, every ticker kept', () => {
    const rows = toSeedRows(TickerFile.parse(TICKERS));

    expect(rows.companies).toEqual([
      { cik: 320193, cik10: '0000320193', ticker: 'AAPL', name: 'Apple Inc.' },
      { cik: 2809, cik10: '0000002809', ticker: 'AEM', name: 'AGNICO EAGLE MINES LTD' },
    ]);
    expect(rows.tickers).toEqual([
      { ticker: 'AAPL', cik: 320193 },
      { ticker: 'AEM', cik: 2809 },
      { ticker: 'AEMRF', cik: 2809 },
    ]);
  });

  test('the primary is the first entry in key order, whichever ticker it is', () => {
    const rows = toSeedRows(TickerFile.parse({
      '0': { cik_str: 2809, ticker: 'AEMRF', title: 'AGNICO EAGLE MINES LTD' },
      '1': { cik_str: 2809, ticker: 'AEM', title: 'AGNICO EAGLE MINES LTD' },
    }));

    expect(rows.companies.map((company) => company.ticker)).toEqual(['AEMRF']);
  });

  test('a ticker listed twice keeps its first CIK', () => {
    const rows = toSeedRows(TickerFile.parse({
      '0': { cik_str: 1, ticker: 'DUP', title: 'First' },
      '1': { cik_str: 2, ticker: 'DUP', title: 'Second' },
    }));

    expect(rows.tickers).toEqual([{ ticker: 'DUP', cik: 1 }]);
    expect(rows.companies).toHaveLength(2);
  });
});

describe('chunked', () => {
  test('splits into chunks of the size, the last one short', () => {
    const rows = Array.from({ length: 1201 }, (_, index) => index);

    const chunks = chunked(rows, SEED_CHUNK_SIZE);

    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 201]);
    expect(chunks.flat()).toEqual(rows);
  });

  test('no rows is no chunks', () => {
    expect(chunked([], SEED_CHUNK_SIZE)).toEqual([]);
  });

  test('refuses a size that is not a positive integer', () => {
    expect(() => chunked([1], 0)).toThrow(RangeError);
    expect(() => chunked([1], 1.5)).toThrow(RangeError);
  });
});

describe('seed', () => {
  test('reads src/data/seeds/data/company_tickers.json by default', () => {
    expect(TICKERS_FILE).toBe(join(import.meta.dir, '..', '..', '..', 'src', 'data', 'seeds', 'data', 'company_tickers.json'));
    expect(existsSync(TICKERS_FILE)).toBe(true);
  });
});
