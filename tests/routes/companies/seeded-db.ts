/**
 * The companies the companies route, tool and store tests read: a migrated `:memory:` database
 * seeded from a small ticker list shaped like the SEC file, through the seed's own
 * `seedTickers`.
 *
 * @module
 */

import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { seedTickers } from '../../../src/data/seeds/01-companies.ts';
import { openMigratedMemoryDb } from '../../support/sqlite-db.ts';

/**
 * Four companies, one with a secondary ticker: CIK 2809 trades as `AEM` and `AEMRF`. None of
 * them is among the companies stub's two, so an answer that matches them came from the table.
 */
export const SEEDED_TICKERS = {
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 2809, ticker: 'AEM', title: 'AGNICO EAGLE MINES LTD' },
  '2': { cik_str: 2809, ticker: 'AEMRF', title: 'AGNICO EAGLE MINES LTD' },
  '3': { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' },
  '4': { cik_str: 104169, ticker: 'WMT', title: 'Walmart Inc.' },
};

/** The primary tickers of the seeded companies in the order the list answers them: by name. */
export const SEEDED_TICKERS_BY_NAME = ['AEM', 'AAPL', 'BRK-B', 'WMT'];

/**
 * Opens a migrated `:memory:` database and seeds {@link SEEDED_TICKERS} into it.
 *
 * @returns The client; `client.$client.close()` ends the database.
 * @throws When the seed's insert is refused.
 */
export async function openSeededCompaniesDb(): Promise<SqliteTestClient> {
  const db = openMigratedMemoryDb();
  await seedTickers(db, SEEDED_TICKERS);
  return db;
}

/**
 * Whether the company with `cik` is stored as selected, read with SQL so an assertion does not
 * lean on the code it tests.
 *
 * @param db - The seeded database.
 * @param cik - The company's unpadded CIK.
 * @returns The stored flag, or `undefined` when no company has the CIK.
 */
export function storedSelected(db: SqliteTestClient, cik: number): boolean | undefined {
  const row = db.$client.query<{ selected: number }, [number]>('select selected from companies where cik = ?').get(cik);
  return row === null
    ? undefined
    : row.selected === 1;
}

/**
 * Sets the stored `selected` flag of every company to `false`, then to `true` for `ciks`, with
 * SQL, so a filter test does not lean on the code it tests.
 *
 * @param db - The seeded database.
 * @param ciks - The CIKs to mark selected.
 * @returns Nothing; the rows are written.
 */
export function selectOnlyWithSql(db: SqliteTestClient, ciks: readonly number[]): void {
  db.$client.run('update companies set selected = 0');
  for (const cik of ciks) db.$client.run('update companies set selected = 1 where cik = ?', [cik]);
}
