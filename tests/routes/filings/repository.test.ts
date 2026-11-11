import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Company } from '../../../src/entities/company.ts';
import { Filing } from '../../../src/entities/filing.ts';
import { CompanySummary } from '../../../src/routes/filings/contract.ts';
import { companyLookupStore, filingStore } from '../../../src/routes/filings/repository.ts';
import { selectOnlyWithSql } from '../companies/seeded-db.ts';
import { APPLE_10K, FIXED_COMPANIES, FIXED_FILINGS } from '../fixtures.ts';

import { APPLE_CIK, openSeededFilingsDb } from './seeded-db.ts';

let db: SqliteTestClient;

beforeEach(async () => {
  db = await openSeededFilingsDb();
});

afterEach(() => {
  db.$client.close();
});

describe('the route fixtures', () => {
  test('hold companies and filings that each pass their entity', () => {
    expect(FIXED_COMPANIES.length).toBeGreaterThan(0);
    expect(FIXED_FILINGS.length).toBeGreaterThan(0);
    for (const company of FIXED_COMPANIES) expect(Company.parse(company)).toEqual(company);
    for (const filing of FIXED_FILINGS) expect(Filing.parse(filing)).toEqual(filing);
  });
});

describe('companyLookupStore(db).findByTicker', () => {
  test('resolves a primary and a secondary ticker to the stored company, and an unknown one to undefined', async () => {
    const store = companyLookupStore(db);

    expect(await store.findByTicker('AAPL')).toMatchObject({ cik: APPLE_CIK, ticker: 'AAPL', selected: true });
    expect(await store.findByTicker('AEMRF')).toMatchObject({ cik: 2809, ticker: 'AEM' });
    expect(await store.findByTicker('NOPE')).toBeUndefined();
  });
});

describe('filingStore(db).page', () => {
  test('answers the stored filings matching the base form, each equal to the stored fixture, and none for another form', async () => {
    const tenK = await filingStore(db).page({ cik: APPLE_CIK, form: '10-K', sort: '-filingDate', offset: 0, limit: 25 });
    const eightK = await filingStore(db).page({ cik: APPLE_CIK, form: '8-K', sort: 'filingDate', offset: 0, limit: 25 });

    expect(tenK).toEqual({ items: [...FIXED_FILINGS], total: FIXED_FILINGS.length });
    expect(eightK).toEqual({ items: [], total: 0 });
  });

  test('a window past the last match is empty and keeps the real total', async () => {
    const outcome = await filingStore(db).page({ cik: APPLE_CIK, form: undefined, sort: '-filingDate', offset: 25, limit: 25 });

    expect(outcome).toEqual({ items: [], total: FIXED_FILINGS.length });
  });

  test('a stored company with no filings answers an empty page', async () => {
    const outcome = await filingStore(db).page({ cik: 104169, form: undefined, sort: '-filingDate', offset: 0, limit: 25 });

    expect(outcome).toEqual({ items: [], total: 0 });
  });
});

describe('filingStore(db).summary', () => {
  test('answers the selected companies only, each a valid CompanySummary with its counts and latest 10-K', async () => {
    const slice = await filingStore(db).summary({ form: undefined, offset: 0, limit: 25 });

    expect(slice.total).toBe(1);
    expect(slice.items).toHaveLength(1);
    const [apple] = slice.items;
    expect(CompanySummary.parse(apple)).toEqual({
      cik: APPLE_CIK,
      ticker: 'AAPL',
      name: 'Apple Inc.',
      counts: { '10-K': 1, '10-Q': 0, '8-K': 0, total: 1 },
      latest10K: { filingDate: '2026-11-03', links: APPLE_10K.links },
      filingsSyncedAt: null,
    });
  });

  test('passes form and the window through to the repository', async () => {
    selectOnlyWithSql(db, [APPLE_CIK, 104169]);

    const narrowed = await filingStore(db).summary({ form: '8-K', offset: 0, limit: 25 });
    const second = await filingStore(db).summary({ form: undefined, offset: 1, limit: 1 });

    expect(narrowed.items.map((summary) => summary.counts)).toEqual([
      { '10-K': 0, '10-Q': 0, '8-K': 0, total: 0 },
      { '10-K': 0, '10-Q': 0, '8-K': 0, total: 0 },
    ]);
    expect(second).toMatchObject({ items: [{ ticker: 'WMT' }], total: 2 });
  });
});
