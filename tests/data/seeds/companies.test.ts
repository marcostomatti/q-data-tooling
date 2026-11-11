import type { Db } from '../../../src/data/repositories/db.ts';

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getTableName, type Table } from 'drizzle-orm';
import { ZodError } from 'zod';

import { chunked, seed, SEED_CHUNK_SIZE, seedTickers, TickerFile, TICKERS_FILE, toSeedRows } from '../../../src/data/seeds/01-companies.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../../support/sqlite-db.ts';

/** A small ticker list shaped like the SEC file: a company with two tickers and one with one. */
const TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 2809, ticker: 'AEM', title: 'AGNICO EAGLE MINES LTD' },
  '2': { cik_str: 2809, ticker: 'AEMRF', title: 'AGNICO EAGLE MINES LTD' },
};

type CompanyRow = { cik: number; cik10: string; ticker: string; name: string; selected: number };
type TickerRow = { ticker: string; cik: number };

let db: SqliteTestClient;
let workDir: string;

beforeEach(() => {
  db = openMigratedMemoryDb();
  workDir = mkdtempSync(join(tmpdir(), 'companies-seed-'));
});

afterEach(() => {
  db.$client.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** The stored companies, read with SQL so the check sees what is in the table. */
function storedCompanies(): CompanyRow[] {
  return db.$client.query<CompanyRow, []>('select cik, cik10, ticker, name, selected from companies order by cik').all();
}

/** The stored tickers, read with SQL, by ticker. */
function storedTickers(): TickerRow[] {
  return db.$client.query<TickerRow, []>('select ticker, cik from company_tickers order by ticker').all();
}

/** `count` entries with distinct CIKs and tickers, keyed as the SEC file keys them. */
function manyTickers(count: number): TickerFile {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    String(index),
    { cik_str: index + 1, ticker: `T${index}`, title: `Company ${index}` },
  ]));
}

/** `db` with every `insert` recorded by table name, so a test can count the statements. */
function countingInserts(target: SqliteTestClient): { readonly db: Db; readonly inserts: string[] } {
  const inserts: string[] = [];
  const insert = (table: Table): ReturnType<Db['insert']> => {
    inserts.push(getTableName(table));
    return target.insert(table as Parameters<Db['insert']>[0]);
  };
  const proxy = new Proxy(target, {
    get: (object, property, receiver): unknown => property === 'insert'
      ? insert
      : Reflect.get(object, property, receiver),
  });
  return { db: proxy, inserts };
}

/** Writes `content` as a ticker file in the test's own folder and returns its path. */
function tickerFileWith(content: string): string {
  const path = join(workDir, 'company_tickers.json');
  writeFileSync(path, content);
  return path;
}

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

describe('seedTickers', () => {
  test('writes one company per CIK and every ticker', async () => {
    await seedTickers(db, TickerFile.parse(TICKERS));

    expect(storedCompanies()).toEqual([
      { cik: 2809, cik10: '0000002809', ticker: 'AEM', name: 'AGNICO EAGLE MINES LTD', selected: 0 },
      { cik: 320193, cik10: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', selected: 0 },
    ]);
    expect(storedTickers()).toEqual([
      { ticker: 'AAPL', cik: 320193 },
      { ticker: 'AEM', cik: 2809 },
      { ticker: 'AEMRF', cik: 2809 },
    ]);
  });

  test('a second run writes nothing new and keeps a selected company selected', async () => {
    await seedTickers(db, TickerFile.parse(TICKERS));
    db.$client.run('update companies set selected = 1 where cik = 2809');

    await seedTickers(db, TickerFile.parse(TICKERS));

    expect(storedCompanies()).toHaveLength(2);
    expect(storedTickers()).toHaveLength(3);
    expect(storedCompanies().find((company) => company.cik === 2809)?.selected).toBe(1);
  });

  test('inserts in chunks of 500, companies before tickers', async () => {
    const { db: counting, inserts } = countingInserts(db);

    await seedTickers(counting, manyTickers(1201));

    expect(inserts).toEqual(['companies', 'companies', 'companies', 'company_tickers', 'company_tickers', 'company_tickers']);
    expect(storedCompanies()).toHaveLength(1201);
    expect(storedTickers()).toHaveLength(1201);
  });
});

describe('seed', () => {
  test('reads src/data/seeds/data/company_tickers.json by default', () => {
    expect(TICKERS_FILE).toBe(join(import.meta.dir, '..', '..', '..', 'src', 'data', 'seeds', 'data', 'company_tickers.json'));
    expect(existsSync(TICKERS_FILE)).toBe(true);
  });

  test('reads, validates and writes the ticker file it is given', async () => {
    await seed(db, tickerFileWith(JSON.stringify(TICKERS)));

    expect(storedCompanies().map((company) => company.ticker)).toEqual(['AEM', 'AAPL']);
    expect(storedTickers()).toHaveLength(3);
  });

  test('a file off the TickerFile shape throws a ZodError and writes nothing', async () => {
    const broken = { ...TICKERS, '3': { cik_str: '1', ticker: 'BAD', title: 'Bad' } };

    const failure = await seed(db, tickerFileWith(JSON.stringify(broken))).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ZodError);
    expect(storedCompanies()).toEqual([]);
    expect(storedTickers()).toEqual([]);
  });

  test('a file that is not JSON throws a SyntaxError and writes nothing', async () => {
    const failure = await seed(db, tickerFileWith('{ not json')).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SyntaxError);
    expect(storedCompanies()).toEqual([]);
  });
});
