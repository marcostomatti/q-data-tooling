import type { Company, CompanyPage, CompanyQuery } from '../../api.ts';

/** The Companies page's nav label, which the shell's topbar shows as the page's title. */
export const COMPANIES_TITLE = 'Companies';

/** What the Companies page's empty state says while the page lists no companies yet. */
export const COMPANIES_EMPTY_TITLE = 'No companies yet';

/** What the Companies page's empty state tells the reader the page will hold. */
export const COMPANIES_EMPTY_DESCRIPTION = 'The tracked companies will be listed here.';

/** The toolbar filter's first segment, which lists every tracked company. */
export const ALL_COMPANIES_LABEL = 'All';

/** The toolbar filter's second segment, which keeps only the companies in the summary. */
export const SELECTED_ONLY_LABEL = 'Selected';

/** The toolbar filter's segments, in order: every company, then the selected ones. */
export const COMPANY_FILTERS = [
  { key: 'all', label: ALL_COMPANIES_LABEL },
  { key: 'selected', label: SELECTED_ONLY_LABEL },
] as const;

/** How long the search waits after the last keystroke before it asks the server, in milliseconds. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The companies one page holds, the route's own default page size. */
export const COMPANIES_PAGE_SIZE = 25;

/** The query the page opens on: the first page, no search, every company. */
export const INITIAL_QUERY: CompanyQuery = { page: 1, pageSize: COMPANIES_PAGE_SIZE, q: '', selectedOnly: false };

/** What a ministat of a company row shows when the company has not been synced yet. */
export const NOT_SYNCED = 'never';

/** What the exchange ministat shows when the company lists no exchange, before its first sync. */
export const NO_EXCHANGE = '—';

/** What the Companies page needs from the server; the real one by default, a stand-in in tests. */
export interface CompaniesApi {
  list(query: CompanyQuery): Promise<CompanyPage>
  /** Sets the company in or out of the summary, with the explicit flag, and answers it as it stands. */
  select(ticker: string, selected: boolean): Promise<Company>
}

/**
 * The page with one company replaced by the server's answer for it, matched by ticker. A company
 * the page no longer holds leaves the same page object, so React skips the render.
 *
 * @param page - The page the view holds.
 * @param company - The company as the server answered it.
 * @returns The page to show next.
 */
export function withCompany(page: CompanyPage, company: Company): CompanyPage {
  return page.items.some((item) => item.ticker === company.ticker)
    ? { ...page, items: page.items.map((item) => item.ticker === company.ticker
      ? company
      : item) }
    : page;
}

/**
 * The query with a new search text, back on page 1, since the old page may not exist under it.
 * The same query comes back when the trimmed text is unchanged, so React skips the refetch.
 *
 * @param query - The query the page holds.
 * @param text - The search text as typed.
 * @returns The query to fetch next.
 */
export function withSearch(query: CompanyQuery, text: string): CompanyQuery {
  const q = text.trim();
  return q === query.q
    ? query
    : { ...query, q, page: 1 };
}

/**
 * The query with the selected-only filter set, back on page 1.
 *
 * @param query - The query the page holds.
 * @param selectedOnly - Whether to keep only the companies in the summary.
 * @returns The query to fetch next.
 */
export function withSelectedOnly(query: CompanyQuery, selectedOnly: boolean): CompanyQuery {
  return { ...query, selectedOnly, page: 1 };
}
