import type { CompanyListQuery, CompanyListSlice } from './list.flow.ts';
import type { Company } from '../../entities/company.ts';

/**
 * The fixed companies the stub store answers with until the Database and seed stage wires the
 * flows to a repository. Their header fields are public SEC facts; the fields a sync fills stay
 * empty, as they do for a company never synced.
 */
export const STUB_COMPANIES: readonly Company[] = [
  {
    cik: 320193,
    cik10: '0000320193',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    selected: true,
    exchanges: [],
    sic: null,
    sicDescription: null,
    category: null,
    fiscalYearEnd: null,
    filingsSyncedAt: null,
  },
  {
    cik: 789019,
    cik10: '0000789019',
    ticker: 'MSFT',
    name: 'MICROSOFT CORP',
    selected: false,
    exchanges: [],
    sic: null,
    sicDescription: null,
    category: null,
    fiscalYearEnd: null,
    filingsSyncedAt: null,
  },
];

/** Whether a company matches `q`: its ticker starts with it or its name contains it, in any case. */
function matchesQuery(company: Company, q: string | undefined): boolean {
  if (q === undefined) return true;
  const wanted = q.toUpperCase();
  return company.ticker.startsWith(wanted) || company.name.toUpperCase().includes(wanted);
}

/**
 * The store the companies flows read in this stage, over {@link STUB_COMPANIES}. It filters and
 * pages the fixed rows as the repository will, and keeps nothing: `setSelected` answers the
 * company with the flag set and leaves the fixed rows as they were.
 */
export const companyStubStore = {
  /**
   * The fixed companies matching the query, in the window it names.
   *
   * @param query - The filters and the window.
   * @returns The rows in the window and the count of every match.
   */
  async list(query: CompanyListQuery): Promise<CompanyListSlice> {
    const matching = STUB_COMPANIES.filter((company) => matchesQuery(company, query.q) &&
      (query.selected === undefined || company.selected === query.selected));
    return { items: matching.slice(query.offset, query.offset + query.limit), total: matching.length };
  },

  /**
   * The fixed company with the ticker, with `selected` set.
   *
   * @param ticker - The upper-case ticker.
   * @param selected - Whether the company is in the summary.
   * @returns The company with the flag set, or `undefined` when no fixed company has the ticker.
   */
  async setSelected(ticker: string, selected: boolean): Promise<Company | undefined> {
    const found = STUB_COMPANIES.find((company) => company.ticker === ticker);
    return found === undefined
      ? undefined
      : { ...found, selected };
  },
};
