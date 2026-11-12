/**
 * The stores the filings flows read through their injected `deps`: one method per store call
 * they make, each a call into a shared repository over the `Db` the route or the tool was
 * handed. The companies lookup reads `src/data/repositories/companies.ts` and the filings store
 * reads `src/data/repositories/filings.ts`. Both read stored rows only. The sync sources
 * {@link syncSourcesFor} builds write through the same repositories and hold the SEC client they
 * are handed; nothing here builds an SEC client of its own.
 *
 * @module
 */

import type { FilingPageQuery, FilingSlice } from './list.flow.ts';
import type { SummaryQuery, SummarySlice } from './summary.flow.ts';
import type { FilingSyncSources } from './sync.flow.ts';
import type { Db } from '../../data/repositories/db.ts';
import type { Company } from '../../entities/company.ts';
import type { SecClient } from '../../sec/client.ts';

import { findCompanyByTicker, updateCompanyHeader } from '../../data/repositories/companies.ts';
import { deleteFilingsBefore, insertFilings, pageFilings, summarizeSelectedFilings } from '../../data/repositories/filings.ts';

/** The store {@link companyLookupStore} builds: it fits `ListFilingsDeps['companies']` by shape. */
export interface CompanyLookupStore {
  /**
   * The company trading under the ticker, primary or secondary.
   *
   * @param ticker - The upper-case ticker.
   * @returns The company, or `undefined` when no company trades under the ticker.
   * @throws When the database refuses the read.
   */
  findByTicker(ticker: string): Promise<Company | undefined>
}

/** The store {@link filingStore} builds: it fits `ListFilingsDeps['filings']` and `SummarizeFilingsDeps['filings']` by shape. */
export interface FilingStore {
  /**
   * The window of one company's stored filings the query names, in its order, and the count of
   * every match. `form` matches the base form, so an amendment is kept under its form.
   *
   * @param query - The CIK, the form filter, the order and the window.
   * @returns The rows in the window and the count of every match.
   * @throws When the database refuses the read.
   */
  page(query: FilingPageQuery): Promise<FilingSlice>
  /**
   * The window of the selected companies' summaries, by name, and the count of every selected
   * company. A `form` narrows the counts to that form and keeps every selected company.
   *
   * @param query - The form filter and the window.
   * @returns The summaries in the window and the count of every selected company.
   * @throws When the database refuses a read.
   */
  summary(query: SummaryQuery): Promise<SummarySlice>
}

/**
 * The companies lookup over `db`, for the filings list flow's `deps.companies`.
 *
 * @param db - The client or open transaction the store reads through.
 * @returns The store, its method bound to `db`.
 */
export function companyLookupStore(db: Db): CompanyLookupStore {
  return { findByTicker: async (ticker) => findCompanyByTicker(db, ticker) };
}

/**
 * The filings store over `db`, for the filings flows' `deps.filings`.
 *
 * @param db - The client or open transaction the store reads through.
 * @returns The store, its methods bound to `db`.
 */
export function filingStore(db: Db): FilingStore {
  return {
    page: async (query) => pageFilings(db, query),
    summary: async (query) => summarizeSelectedFilings(db, query),
  };
}

/**
 * The sources a sync of one company reads and writes through, for the `sync` of the filings list
 * flow's and the companies update flow's deps: the SEC client as it is handed, the header write
 * of `updateCompanyHeader`, the insert and delete of the shared filings repository over `db`, and
 * the system clock. With no client there is nothing to sync from, so the answer is `undefined`
 * and the flows read and write the stored rows only.
 *
 * @param db - The client or open transaction the stores write through.
 * @param sec - The SEC client the route or the tool was handed, or `undefined`.
 * @returns The sync sources, or `undefined` when `sec` is.
 */
export function syncSourcesFor(db: Db, sec: SecClient | undefined): FilingSyncSources | undefined {
  if (sec === undefined) return undefined;
  return {
    sec,
    companies: { updateHeader: async (cik, header) => updateCompanyHeader(db, cik, header) },
    filings: {
      insert: async (rows) => insertFilings(db, rows),
      deleteBefore: async (cik, cutoff) => deleteFilingsBefore(db, cik, cutoff),
    },
    now: () => new Date(),
  };
}
