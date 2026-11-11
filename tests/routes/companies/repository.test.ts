import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Company } from '../../../src/entities/company.ts';
import { companyStore } from '../../../src/routes/companies/repository.ts';

import { openSeededCompaniesDb, SEEDED_TICKERS_BY_NAME, selectOnlyWithSql, storedSelected } from './seeded-db.ts';

let db: SqliteTestClient;

beforeEach(async () => {
  db = await openSeededCompaniesDb();
});

afterEach(() => {
  db.$client.close();
});

describe('companyStore(db).findByTicker', () => {
  test('resolves a primary and a secondary ticker to the same company', async () => {
    const store = companyStore(db);

    const [primary, secondary] = await Promise.all([store.findByTicker('AEM'), store.findByTicker('AEMRF')]);

    expect(primary).toMatchObject({ cik: 2809, ticker: 'AEM' });
    expect(secondary).toEqual(primary);
    expect(Company.safeParse(primary).success).toBe(true);
  });

  test('answers undefined for a ticker no company trades under', async () => {
    expect(await companyStore(db).findByTicker('NOPE')).toBeUndefined();
  });
});

describe('companyStore(db).list', () => {
  test('answers the stored companies by name in the window, each a valid Company, with the total', async () => {
    const slice = await companyStore(db).list({ q: undefined, selected: undefined, offset: 1, limit: 2 });

    expect(slice.items.map((company) => company.ticker)).toEqual(SEEDED_TICKERS_BY_NAME.slice(1, 3));
    expect(slice.total).toBe(SEEDED_TICKERS_BY_NAME.length);
    for (const company of slice.items) expect(Company.safeParse(company).success).toBe(true);
  });

  test('passes q and selected through to the table', async () => {
    selectOnlyWithSql(db, [2809, 104169]);

    const slice = await companyStore(db).list({ q: 'aemr', selected: true, offset: 0, limit: 10 });

    expect(slice).toMatchObject({ items: [{ cik: 2809, ticker: 'AEM' }], total: 1 });
  });

  test('a window past the last match is empty and keeps the real total', async () => {
    const slice = await companyStore(db).list({ q: undefined, selected: undefined, offset: 40, limit: 10 });

    expect(slice).toEqual({ items: [], total: SEEDED_TICKERS_BY_NAME.length });
  });
});

describe('companyStore(db).setSelected', () => {
  test('stores the flag on the company a secondary ticker names, and answers it', async () => {
    const updated = await companyStore(db).setSelected('AEMRF', true);

    expect(updated).toMatchObject({ cik: 2809, ticker: 'AEM', selected: true });
    expect(storedSelected(db, 2809)).toBe(true);
    expect(storedSelected(db, 320193)).toBe(false);
  });

  test('answers undefined for a ticker no company trades under, and stores nothing', async () => {
    const updated = await companyStore(db).setSelected('NOPE', true);

    expect(updated).toBeUndefined();
    const slice = await companyStore(db).list({ q: undefined, selected: true, offset: 0, limit: 10 });
    expect(slice.total).toBe(0);
  });
});
