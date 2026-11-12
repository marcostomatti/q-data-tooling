/**
 * The filings the filings route, tool and store tests read: the seeded companies of
 * `tests/integration/routes/companies/seeded-db.ts`, with Apple the one selected company and
 * `FIXED_FILINGS` stored through the repository's own `insertFilings`, in a file's scratch
 * Postgres database.
 *
 * @module
 */

import type { TestDatabase } from '../../../support/test-db.ts';

import { insertFilings } from '../../../../src/data/repositories/filings.ts';
import { FIXED_FILINGS } from '../../../routes/fixtures.ts';
import { seedCompanies, selectOnlyWithSql } from '../companies/seeded-db.ts';

/** The CIK of Apple, the one seeded company with stored filings and the one selected. */
export const APPLE_CIK = 320193;

/**
 * Seeds the companies into an empty database (one just opened, or one just `reset()`), marks
 * Apple alone selected and stores `FIXED_FILINGS`.
 *
 * @param database - The file's scratch database.
 * @returns Nothing; the rows are written.
 * @throws When the seed's or the filings' insert is refused, or when not every fixed filing is stored.
 */
export async function seedFilings(database: TestDatabase): Promise<void> {
  await seedCompanies(database);
  await selectOnlyWithSql(database, [APPLE_CIK]);
  const stored = await insertFilings(database.db, FIXED_FILINGS);
  if (stored !== FIXED_FILINGS.length) throw new Error(`stored ${stored} of ${FIXED_FILINGS.length} fixed filings`);
}
