/**
 * The companies the companies route, tool and store tests read: a small ticker list shaped like
 * the SEC file, seeded into a file's scratch Postgres database (`openTestDatabase` from
 * `tests/support/test-db.ts`) through the seed's own `seedTickers`.
 *
 * A file opens its database in `beforeAll` and seeds it with {@link seedCompanies}, once there or
 * after each `reset()` in `beforeEach`. The checks read and write the rows with SQL on the raw
 * handle, so an assertion does not lean on the code it tests.
 *
 * @module
 */

import type { TestDatabase } from '../../../support/test-db.ts';

import { seedTickers } from '../../../../src/data/seeds/01-companies.ts';

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
 * Seeds {@link SEEDED_TICKERS} into an empty database: one just opened, or one just `reset()`.
 *
 * @param database - The file's scratch database.
 * @returns Nothing; the rows are written.
 * @throws When the seed's insert is refused.
 */
export async function seedCompanies(database: TestDatabase): Promise<void> {
  await seedTickers(database.db, SEEDED_TICKERS);
}

/**
 * Whether the company with `cik` is stored as selected, read with SQL so an assertion does not
 * lean on the code it tests.
 *
 * @param database - The seeded database.
 * @param cik - The company's unpadded CIK.
 * @returns The stored flag, or `undefined` when no company has the CIK.
 * @throws When the database refuses the read.
 */
export async function storedSelected(database: TestDatabase, cik: number): Promise<boolean | undefined> {
  const [row] = await database.sql<{ selected: boolean }[]>`select selected from companies where cik = ${cik}`;
  return row?.selected;
}

/**
 * Sets the stored `selected` flag of every company to `false`, then to `true` for `ciks`, with
 * SQL, so a filter test does not lean on the code it tests.
 *
 * @param database - The seeded database.
 * @param ciks - The CIKs to mark selected.
 * @returns Nothing; the rows are written.
 * @throws When the database refuses the write.
 */
export async function selectOnlyWithSql(database: TestDatabase, ciks: readonly number[]): Promise<void> {
  await database.sql`update companies set selected = false`;
  if (ciks.length > 0) await database.sql`update companies set selected = true where cik in ${database.sql(ciks)}`;
}
