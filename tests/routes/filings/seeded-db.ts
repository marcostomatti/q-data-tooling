/**
 * The filings the filings route, tool and store tests read: the seeded companies of
 * `tests/routes/companies/seeded-db.ts`, with Apple the one selected company and
 * `FIXED_FILINGS` stored through the repository's own `insertFilings`.
 *
 * @module
 */

import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { insertFilings } from '../../../src/data/repositories/filings.ts';
import { openSeededCompaniesDb, selectOnlyWithSql } from '../companies/seeded-db.ts';
import { FIXED_FILINGS } from '../fixtures.ts';

/** The CIK of Apple, the one seeded company with stored filings and the one selected. */
export const APPLE_CIK = 320193;

/**
 * Opens the seeded companies database, marks Apple alone selected and stores `FIXED_FILINGS`.
 *
 * @returns The client; `client.$client.close()` ends the database.
 * @throws When the seed's or the filings' insert is refused, or when not every fixed filing is stored.
 */
export async function openSeededFilingsDb(): Promise<SqliteTestClient> {
  const db = await openSeededCompaniesDb();
  selectOnlyWithSql(db, [APPLE_CIK]);
  const stored = await insertFilings(db, FIXED_FILINGS);
  if (stored !== FIXED_FILINGS.length) throw new Error(`stored ${stored} of ${FIXED_FILINGS.length} fixed filings`);
  return db;
}
