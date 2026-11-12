/**
 * The companies the seed writes from the real `src/data/seeds/data/company_tickers.json`, read
 * through the route table: the counts after seeding twice, the two tickers of CIK 2809, the
 * order of the list and a repeated `PATCH`. The other companies tests run over a small inline
 * ticker list; this file is the one that runs the seed runner over the file `db:seed` reads.
 */

import type { TestDatabase } from '../../../support/test-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { runSeeds } from '../../../../src/data/seed.ts';
import { mountRoutes } from '../../../../src/routes/http.ts';
import { startTestServer, type TestServer } from '../../../http/harness.ts';
import { captureLog } from '../../../support/capture-log.ts';
import { openTestDatabase } from '../../../support/test-db.ts';

import { storedSelected } from './seeded-db.ts';

/** The companies and tickers in the SEC file the repository ships. */
const COMPANY_COUNT = 8009;
const TICKER_COUNT = 10414;

/** The largest `pageSize` the list contract accepts. */
const MAX_PAGE_SIZE = 100;

const { log } = captureLog();

let database: TestDatabase;
let server: TestServer;

beforeAll(async () => {
  database = await openTestDatabase();
  await runSeeds(database.db);
  await runSeeds(database.db);
  server = await startTestServer((app) => mountRoutes(app, database.db, log));
});

afterAll(async () => {
  await server.close();
  await database.close();
});

/** How many rows `table` holds, counted with SQL. */
async function rowsIn(table: 'companies' | 'company_tickers'): Promise<number> {
  const [row] = await database.sql<{ total: number }[]>`select count(*)::int as total from ${database.sql(table)}`;
  return row?.total ?? 0;
}

/** The `data` of a successful list answer. */
interface ListData {
  readonly items: readonly { readonly cik: number; readonly ticker: string; readonly name: string }[]
  readonly total: number
}

/** Reads one page of `GET /api/companies` and returns its `data`. */
async function listPage(page: number): Promise<ListData> {
  const outcome = await server.request('GET', `/api/companies?page=${page}&pageSize=${MAX_PAGE_SIZE}`);
  expect(outcome.status).toBe(200);
  return (outcome.body as { data: ListData }).data;
}

describe('seeding the SEC ticker file twice', () => {
  test('leaves 8,009 companies and 10,414 tickers', async () => {
    expect(await rowsIn('companies')).toBe(COMPANY_COUNT);
    expect(await rowsIn('company_tickers')).toBe(TICKER_COUNT);
  });

  test('a third run still leaves the same counts', async () => {
    await runSeeds(database.db);

    expect(await rowsIn('companies')).toBe(COMPANY_COUNT);
    expect(await rowsIn('company_tickers')).toBe(TICKER_COUNT);
  });
});

describe('AEM and AEMRF', () => {
  test.each(['AEM', 'AEMRF'])('%s resolves to CIK 2809 through the route', async (ticker) => {
    const outcome = await server.request('GET', `/api/companies?q=${ticker}`);

    expect(outcome.status).toBe(200);
    const { items } = (outcome.body as { data: ListData }).data;
    expect(items.filter((company) => company.cik === 2809)).toEqual([
      expect.objectContaining({ cik: 2809, ticker: 'AEM', name: 'AGNICO EAGLE MINES LTD' }),
    ]);
  });

  test('both tickers are stored against the one company', async () => {
    const rows = await database.sql<{ ticker: string; cik: number }[]>`select ticker, cik from company_tickers where ticker in ('AEM', 'AEMRF') order by ticker`;

    expect([...rows]).toEqual([{ ticker: 'AEM', cik: 2809 }, { ticker: 'AEMRF', cik: 2809 }]);
  });
});

describe('GET /api/companies over the full file', () => {
  test('reports the real total on the first page', async () => {
    const first = await listPage(1);

    expect(first.total).toBe(COMPANY_COUNT);
    expect(first.items).toHaveLength(MAX_PAGE_SIZE);
  });

  test('lists the companies alphabetically by name, ignoring case, across page boundaries', async () => {
    const pages = [await listPage(1), await listPage(2), await listPage(3)];

    const names = pages.flatMap((page) => page.items.map((company) => company.name));

    const alphabetical = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect(names).toHaveLength(MAX_PAGE_SIZE * 3);
    expect(names).toEqual(alphabetical);
  });
});

describe('PATCH /api/companies/:ticker over the full file', () => {
  test('selected: true sent twice leaves the company selected', async () => {
    const first = await server.request('PATCH', '/api/companies/AEM', { selected: true });
    const second = await server.request('PATCH', '/api/companies/AEM', { selected: true });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, data: { cik: 2809, ticker: 'AEM', selected: true } });
    expect(await storedSelected(database, 2809)).toBe(true);
  });

  test('seeding again keeps the company selected', async () => {
    await runSeeds(database.db);

    expect(await storedSelected(database, 2809)).toBe(true);
    expect(await rowsIn('companies')).toBe(COMPANY_COUNT);
  });
});
