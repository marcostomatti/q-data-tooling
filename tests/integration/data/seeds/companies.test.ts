import type { ActiveClient } from '../../../../src/data/active.ts';
import type { Db } from '../../../../src/data/repositories/db.ts';
import type { TestDatabase } from '../../../support/test-db.ts';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { getTableName, type Table } from 'drizzle-orm';
import { ZodError } from 'zod';

import { seed, seedTickers, TickerFile } from '../../../../src/data/seeds/01-companies.ts';
import { openTestDatabase } from '../../../support/test-db.ts';

/** A small ticker list shaped like the SEC file: a company with two tickers and one with one. */
const TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 2809, ticker: 'AEM', title: 'AGNICO EAGLE MINES LTD' },
  '2': { cik_str: 2809, ticker: 'AEMRF', title: 'AGNICO EAGLE MINES LTD' },
};

type CompanyRow = { cik: number; cik10: string; ticker: string; name: string; selected: boolean };
type TickerRow = { ticker: string; cik: number };

let database: TestDatabase;
let workDir: string;

beforeAll(async () => {
  database = await openTestDatabase();
});

beforeEach(async () => {
  await database.reset();
  workDir = mkdtempSync(join(tmpdir(), 'companies-seed-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

afterAll(async () => {
  await database.close();
});

/** The stored companies, read with SQL so the check sees what is in the table. */
async function storedCompanies(): Promise<CompanyRow[]> {
  return database.sql<CompanyRow[]>`select cik, cik10, ticker, name, selected from companies order by cik`;
}

/** The stored tickers, read with SQL, by ticker. */
async function storedTickers(): Promise<TickerRow[]> {
  return database.sql<TickerRow[]>`select ticker, cik from company_tickers order by ticker`;
}

/** `count` entries with distinct CIKs and tickers, keyed as the SEC file keys them. */
function manyTickers(count: number): TickerFile {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    String(index),
    { cik_str: index + 1, ticker: `T${index}`, title: `Company ${index}` },
  ]));
}

/** `target` with every `insert` recorded by table name, so a test can count the statements. */
function countingInserts(target: ActiveClient): { readonly db: Db; readonly inserts: string[] } {
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

describe('seedTickers', () => {
  test('writes one company per CIK and every ticker', async () => {
    await seedTickers(database.db, TickerFile.parse(TICKERS));

    expect(await storedCompanies()).toEqual([
      { cik: 2809, cik10: '0000002809', ticker: 'AEM', name: 'AGNICO EAGLE MINES LTD', selected: false },
      { cik: 320193, cik10: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', selected: false },
    ]);
    expect(await storedTickers()).toEqual([
      { ticker: 'AAPL', cik: 320193 },
      { ticker: 'AEM', cik: 2809 },
      { ticker: 'AEMRF', cik: 2809 },
    ]);
  });

  test('a second run writes nothing new and keeps a selected company selected', async () => {
    await seedTickers(database.db, TickerFile.parse(TICKERS));
    await database.sql`update companies set selected = true where cik = 2809`;

    await seedTickers(database.db, TickerFile.parse(TICKERS));

    const companies = await storedCompanies();
    expect(companies).toHaveLength(2);
    expect(await storedTickers()).toHaveLength(3);
    expect(companies.find((company) => company.cik === 2809)?.selected).toBe(true);
  });

  test('inserts in chunks of 500, companies before tickers', async () => {
    const { db: counting, inserts } = countingInserts(database.db);

    await seedTickers(counting, manyTickers(1201));

    expect(inserts).toEqual(['companies', 'companies', 'companies', 'company_tickers', 'company_tickers', 'company_tickers']);
    expect(await storedCompanies()).toHaveLength(1201);
    expect(await storedTickers()).toHaveLength(1201);
  });
});

describe('seed', () => {
  test('reads, validates and writes the ticker file it is given', async () => {
    await seed(database.db, tickerFileWith(JSON.stringify(TICKERS)));

    expect((await storedCompanies()).map((company) => company.ticker)).toEqual(['AEM', 'AAPL']);
    expect(await storedTickers()).toHaveLength(3);
  });

  test('a file off the TickerFile shape throws a ZodError and writes nothing', async () => {
    const broken = { ...TICKERS, '3': { cik_str: '1', ticker: 'BAD', title: 'Bad' } };

    const failure = await seed(database.db, tickerFileWith(JSON.stringify(broken))).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ZodError);
    expect(await storedCompanies()).toEqual([]);
    expect(await storedTickers()).toEqual([]);
  });

  test('a file that is not JSON throws a SyntaxError and writes nothing', async () => {
    const failure = await seed(database.db, tickerFileWith('{ not json')).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SyntaxError);
    expect(await storedCompanies()).toEqual([]);
  });
});
