import type { CompanyListFilter } from '../../src/data/repositories/companies.ts';
import type { SqliteTestClient } from '../support/sqlite-db.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { findCompanyByTicker, listCompanies, setCompanySelected, updateCompanyHeader } from '../../src/data/repositories/companies.ts';
import { seedTickers } from '../../src/data/seeds/01-companies.ts';
import { Company } from '../../src/entities/company.ts';
import { openMigratedMemoryDb } from '../support/sqlite-db.ts';

/**
 * A small ticker list shaped like the SEC file. CIK 2809 has a secondary ticker, `AEMRF`, and
 * the names are chosen so `q` can tell a ticker prefix from a name part: `BRK` is a prefix of
 * `BRK-B` and no name contains it, `MART` is in `WALMART INC.` and starts no ticker.
 */
const TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 2809, ticker: 'AEM', title: 'AGNICO EAGLE MINES LTD' },
  '2': { cik_str: 2809, ticker: 'AEMRF', title: 'AGNICO EAGLE MINES LTD' },
  '3': { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' },
  '4': { cik_str: 104169, ticker: 'WMT', title: 'Walmart Inc.' },
  '5': { cik_str: 789019, ticker: 'MSFT', title: '100%_Pure Corp' },
};

/** The names in the order the list must return them: SQLite's binary order of `name`. */
const NAMES_IN_ORDER = ['100%_Pure Corp', 'AGNICO EAGLE MINES LTD', 'Apple Inc.', 'BERKSHIRE HATHAWAY INC', 'Walmart Inc.'];

/** A filter matching every company, in one window wide enough for all of them. */
const EVERY: CompanyListFilter = { q: undefined, selected: undefined, offset: 0, limit: 100 };

let db: SqliteTestClient;

beforeEach(async () => {
  db = openMigratedMemoryDb();
  await seedTickers(db, TICKERS);
});

afterEach(() => {
  db.$client.close();
});

/** The names of the companies `filter` lists, in the order it lists them. */
async function listedNames(filter: Partial<CompanyListFilter>): Promise<string[]> {
  const page = await listCompanies(db, { ...EVERY, ...filter });
  return page.items.map((company) => company.name);
}

/** Marks the company with `cik` selected with SQL, so a filter test does not lean on the code it tests. */
function selectWithSql(cik: number): void {
  db.$client.run('update companies set selected = 1 where cik = ?', [cik]);
}

describe('listCompanies', () => {
  test('lists every company by name, each one a valid Company, with the total', async () => {
    // Act
    const page = await listCompanies(db, EVERY);

    // Assert
    expect(page.items.map((company) => company.name)).toEqual(NAMES_IN_ORDER);
    expect(page.total).toBe(5);
    for (const company of page.items) expect(Company.parse(company)).toEqual(company);
  });

  test('answers a never-synced company with empty header fields', async () => {
    // Act
    const page = await listCompanies(db, { ...EVERY, q: 'AAPL' });

    // Assert
    expect(page.items).toEqual([{
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
    }]);
  });

  test('pages the list in windows that neither overlap nor skip, each with the full total', async () => {
    // Act
    const first = await listCompanies(db, { ...EVERY, offset: 0, limit: 2 });
    const second = await listCompanies(db, { ...EVERY, offset: 2, limit: 2 });
    const third = await listCompanies(db, { ...EVERY, offset: 4, limit: 2 });

    // Assert
    expect([...first.items, ...second.items, ...third.items].map((company) => company.name)).toEqual(NAMES_IN_ORDER);
    expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
    expect(third.items).toHaveLength(1);
  });

  test('answers the window past the last match with no items and the real total', async () => {
    // Act
    const page = await listCompanies(db, { ...EVERY, offset: 100, limit: 25 });

    // Assert
    expect(page).toEqual({ items: [], total: 5 });
  });

  test('matches q as a ticker prefix where no name contains it', async () => {
    // Act / Assert
    expect(await listedNames({ q: 'BRK' })).toEqual(['BERKSHIRE HATHAWAY INC']);
  });

  test('matches q as a prefix of a secondary ticker, answering the company with its primary ticker', async () => {
    // Act
    const page = await listCompanies(db, { ...EVERY, q: 'AEMR' });

    // Assert
    expect(page.items.map((company) => [company.cik, company.ticker])).toEqual([[2809, 'AEM']]);
    expect(page.total).toBe(1);
  });

  test('does not match q inside a ticker that does not start with it', async () => {
    // Arrange: `SFT` is inside `MSFT` and in no name, so only a contains-match on tickers would find it
    // Act / Assert
    expect(await listedNames({ q: 'SFT' })).toEqual([]);
  });

  test('matches q as a part of the name in any case', async () => {
    // Act / Assert
    expect(await listedNames({ q: 'mart' })).toEqual(['Walmart Inc.']);
    expect(await listedNames({ q: 'EAGLE' })).toEqual(['AGNICO EAGLE MINES LTD']);
  });

  test('matches q as a ticker prefix in any case', async () => {
    // Act / Assert
    expect(await listedNames({ q: 'wm' })).toEqual(['Walmart Inc.']);
  });

  test('lists a company once when both a ticker and the name match q, and counts it once', async () => {
    // Arrange: `AEM` starts both of CIK 2809's tickers, so a join on tickers would list it twice
    // Act
    const page = await listCompanies(db, { ...EVERY, q: 'AEM' });

    // Assert
    expect(page.items.map((company) => company.cik)).toEqual([2809]);
    expect(page.total).toBe(1);
  });

  test('matches % and _ in q as themselves, not as wildcards', async () => {
    // Act / Assert
    expect(await listedNames({ q: '%_' })).toEqual(['100%_Pure Corp']);
    expect(await listedNames({ q: '%' })).toEqual(['100%_Pure Corp']);
    expect(await listedNames({ q: '_' })).toEqual(['100%_Pure Corp']);
  });

  test('keeps only the selected companies, or only the others', async () => {
    // Arrange
    selectWithSql(320193);
    selectWithSql(104169);

    // Act / Assert
    expect(await listedNames({ selected: true })).toEqual(['Apple Inc.', 'Walmart Inc.']);
    expect(await listedNames({ selected: false })).toEqual(['100%_Pure Corp', 'AGNICO EAGLE MINES LTD', 'BERKSHIRE HATHAWAY INC']);
  });

  test('applies q and selected together, and the total counts only what both keep', async () => {
    // Arrange
    selectWithSql(320193);

    // Act
    const page = await listCompanies(db, { ...EVERY, q: 'inc', selected: true, limit: 1 });

    // Assert
    expect(page.items.map((company) => company.name)).toEqual(['Apple Inc.']);
    expect(page.total).toBe(1);
  });

  test('counts every match while the window holds fewer', async () => {
    // Act
    const page = await listCompanies(db, { ...EVERY, q: 'inc', limit: 1 });

    // Assert
    expect(page.items.map((company) => company.name)).toEqual(['Apple Inc.']);
    expect(page.total).toBe(3);
  });
});

describe('findCompanyByTicker', () => {
  test('resolves a primary and a secondary ticker to the same company', async () => {
    // Act
    const primary = await findCompanyByTicker(db, 'AEM');
    const secondary = await findCompanyByTicker(db, 'AEMRF');

    // Assert
    expect(primary?.cik).toBe(2809);
    expect(secondary).toEqual(primary);
    expect(secondary?.ticker).toBe('AEM');
  });

  test('answers undefined for a ticker no company trades under', async () => {
    // Act / Assert
    expect(await findCompanyByTicker(db, 'NOPE')).toBeUndefined();
  });

  test('matches the ticker exactly, not as a prefix', async () => {
    // Act / Assert
    expect(await findCompanyByTicker(db, 'AEMR')).toBeUndefined();
  });
});

describe('setCompanySelected', () => {
  test('sets the flag, answers the company after the change and stores it', async () => {
    // Act
    const updated = await setCompanySelected(db, 'AAPL', true);

    // Assert
    expect(updated?.selected).toBe(true);
    expect(updated?.cik).toBe(320193);
    expect(await findCompanyByTicker(db, 'AAPL')).toEqual(updated);
  });

  test('leaves the company selected when set to true twice', async () => {
    // Act
    await setCompanySelected(db, 'AAPL', true);
    const second = await setCompanySelected(db, 'AAPL', true);

    // Assert
    expect(second?.selected).toBe(true);
    expect((await findCompanyByTicker(db, 'AAPL'))?.selected).toBe(true);
  });

  test('clears the flag when set to false', async () => {
    // Arrange
    selectWithSql(320193);

    // Act
    const updated = await setCompanySelected(db, 'AAPL', false);

    // Assert
    expect(updated?.selected).toBe(false);
    expect((await findCompanyByTicker(db, 'AAPL'))?.selected).toBe(false);
  });

  test('sets the company of a secondary ticker', async () => {
    // Act
    const updated = await setCompanySelected(db, 'AEMRF', true);

    // Assert
    expect(updated?.cik).toBe(2809);
    expect((await findCompanyByTicker(db, 'AEM'))?.selected).toBe(true);
  });

  test('changes no other company', async () => {
    // Act
    await setCompanySelected(db, 'AAPL', true);

    // Assert
    expect(await listedNames({ selected: true })).toEqual(['Apple Inc.']);
  });

  test('answers undefined for an unknown ticker and changes nothing', async () => {
    // Act
    const updated = await setCompanySelected(db, 'NOPE', true);

    // Assert
    expect(updated).toBeUndefined();
    expect(await listedNames({ selected: true })).toEqual([]);
  });
});

describe('updateCompanyHeader', () => {
  const syncedAt = new Date('2026-11-10T12:34:56.000Z');
  const header = {
    exchanges: ['Nasdaq'],
    sic: '3571',
    sicDescription: 'Electronic Computers',
    category: 'Large accelerated filer',
    fiscalYearEnd: '0926',
    syncedAt,
  };

  test('writes the header fields and the sync time, and answers the company after the change', async () => {
    // Act
    const updated = await updateCompanyHeader(db, 320193, header);

    // Assert
    expect(updated).toEqual({
      cik: 320193,
      cik10: '0000320193',
      ticker: 'AAPL',
      name: 'Apple Inc.',
      selected: false,
      exchanges: ['Nasdaq'],
      sic: '3571',
      sicDescription: 'Electronic Computers',
      category: 'Large accelerated filer',
      fiscalYearEnd: '0926',
      filingsSyncedAt: '2026-11-10T12:34:56.000Z',
    });
    expect(await findCompanyByTicker(db, 'AAPL')).toEqual(updated);
    expect(Company.parse(updated)).toEqual(updated as Company);
  });

  test('keeps the ticker, the name and the selected flag as they were', async () => {
    // Arrange
    selectWithSql(320193);

    // Act
    const updated = await updateCompanyHeader(db, 320193, header);

    // Assert
    expect(updated?.selected).toBe(true);
    expect(updated?.ticker).toBe('AAPL');
    expect(updated?.name).toBe('Apple Inc.');
  });

  test('stores the exchanges as a JSON array and changes no other company', async () => {
    // Act
    await updateCompanyHeader(db, 320193, { ...header, exchanges: ['Nasdaq', 'NYSE'] });

    // Assert
    const stored = db.$client.query<{ cik: number; exchanges: string }, []>('select cik, exchanges from companies order by cik').all();
    expect(stored).toEqual([
      { cik: 2809, exchanges: '[]' },
      { cik: 104169, exchanges: '[]' },
      { cik: 320193, exchanges: '["Nasdaq","NYSE"]' },
      { cik: 789019, exchanges: '[]' },
      { cik: 1067983, exchanges: '[]' },
    ]);
  });

  test('writes null header fields as null', async () => {
    // Arrange
    await updateCompanyHeader(db, 320193, header);

    // Act
    const updated = await updateCompanyHeader(db, 320193, { ...header, sic: null, sicDescription: null, category: null, fiscalYearEnd: null });

    // Assert
    expect([updated?.sic, updated?.sicDescription, updated?.category, updated?.fiscalYearEnd]).toEqual([null, null, null, null]);
  });

  test('answers undefined for a CIK no company has', async () => {
    // Act / Assert
    expect(await updateCompanyHeader(db, 1, header)).toBeUndefined();
  });
});
