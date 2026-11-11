import { describe, expect, test } from 'bun:test';

import { Filing } from '../../../src/entities/filing.ts';
import { STUB_COMPANIES } from '../../../src/routes/companies/stub.ts';
import { CompanySummary } from '../../../src/routes/filings/contract.ts';
import { companyLookupStubStore, filingStubStore, STUB_FILINGS } from '../../../src/routes/filings/stub.ts';

/** The CIK of the stub's one filing company, Apple. */
const APPLE_CIK = 320193;

describe('the filings stub fixture', () => {
  test('holds filings that each pass the Filing entity', () => {
    expect(STUB_FILINGS.length).toBeGreaterThan(0);
    for (const filing of STUB_FILINGS) expect(Filing.parse(filing)).toEqual(filing);
  });
});

describe('companyLookupStubStore', () => {
  test('resolves a primary ticker to its company and an unknown one to undefined', async () => {
    expect(await companyLookupStubStore.findByTicker('AAPL')).toEqual(STUB_COMPANIES.find((company) => company.ticker === 'AAPL'));
    expect(await companyLookupStubStore.findByTicker('NOPE')).toBeUndefined();
  });
});

describe('filingStubStore.page', () => {
  test('answers the company\'s filings matching the base form, and none for another form', async () => {
    const tenK = await filingStubStore.page({ cik: APPLE_CIK, form: '10-K', sort: '-filingDate', offset: 0, limit: 25 });
    const eightK = await filingStubStore.page({ cik: APPLE_CIK, form: '8-K', sort: '-filingDate', offset: 0, limit: 25 });

    expect(tenK).toEqual({ items: STUB_FILINGS.filter((filing) => filing.baseForm === '10-K'), total: 1 });
    expect(eightK).toEqual({ items: [], total: 0 });
  });

  test('answers a page past the last one with no items and the real total', async () => {
    const outcome = await filingStubStore.page({ cik: APPLE_CIK, form: undefined, sort: '-filingDate', offset: 25, limit: 25 });

    expect(outcome).toEqual({ items: [], total: STUB_FILINGS.length });
  });

  test('answers a company with no filings with an empty page', async () => {
    const outcome = await filingStubStore.page({ cik: 789019, form: undefined, sort: 'filingDate', offset: 0, limit: 25 });

    expect(outcome).toEqual({ items: [], total: 0 });
  });
});

describe('filingStubStore.summary', () => {
  test('summarizes only the selected companies, each passing CompanySummary', async () => {
    const outcome = await filingStubStore.summary({ form: undefined, offset: 0, limit: 25 });

    expect(outcome.items.map((summary) => summary.ticker)).toEqual(STUB_COMPANIES.filter((company) => company.selected).map((company) => company.ticker));
    for (const summary of outcome.items) expect(CompanySummary.parse(summary)).toEqual(summary);
  });

  test('counts Apple\'s filings per base form and carries its latest 10-K', async () => {
    const { items } = await filingStubStore.summary({ form: undefined, offset: 0, limit: 25 });
    const apple = items.find((summary) => summary.cik === APPLE_CIK);
    const tenK = STUB_FILINGS.find((filing) => filing.baseForm === '10-K');
    if (tenK === undefined) throw new Error('STUB_FILINGS holds no 10-K');

    expect(apple?.counts).toEqual({ '10-K': 1, '10-Q': 0, '8-K': 0, total: 1 });
    expect(apple?.latest10K).toEqual({ filingDate: '2026-11-03', links: tenK.links });
  });

  test('keeps only the companies with a filing of the form named', async () => {
    const tenK = await filingStubStore.summary({ form: '10-K', offset: 0, limit: 25 });
    const tenQ = await filingStubStore.summary({ form: '10-Q', offset: 0, limit: 25 });

    expect(tenK.total).toBe(1);
    expect(tenQ).toEqual({ items: [], total: 0 });
  });
});
