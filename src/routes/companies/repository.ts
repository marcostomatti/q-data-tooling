/**
 * The companies store the companies flows read through their injected `deps`: one method per
 * store call they make, each a call into the shared companies repository
 * `src/data/repositories/companies.ts` over the `Db` the route or the tool was handed.
 *
 * @module
 */

import type { CompanyListQuery, CompanyListSlice } from './list.flow.ts';
import type { Db } from '../../data/repositories/db.ts';
import type { Company } from '../../entities/company.ts';

import { listCompanies, setCompanySelected } from '../../data/repositories/companies.ts';

/** The store {@link companyStore} builds: it fits `ListCompaniesDeps` and `UpdateCompanyDeps` by shape. */
export interface CompanyStore {
  /**
   * The window of companies the query names, by name, and the count of every match.
   *
   * @param query - The filters and the window.
   * @returns The rows in the window and the count of every match.
   * @throws When the database refuses the read.
   */
  list(query: CompanyListQuery): Promise<CompanyListSlice>
  /**
   * Sets the `selected` flag of the company that trades under the ticker, primary or secondary.
   *
   * @param ticker - The upper-case ticker.
   * @param selected - Whether the company is in the summary.
   * @returns The company after the change, or `undefined` when no company trades under the ticker.
   * @throws When the database refuses the write.
   */
  setSelected(ticker: string, selected: boolean): Promise<Company | undefined>
}

/**
 * The companies store over `db`, for the companies flows' `deps.store`.
 *
 * @param db - The client or open transaction the store reads and writes through.
 * @returns The store, its methods bound to `db`.
 */
export function companyStore(db: Db): CompanyStore {
  return {
    list: async (query) => listCompanies(db, query),
    setSelected: async (ticker, selected) => setCompanySelected(db, ticker, selected),
  };
}
