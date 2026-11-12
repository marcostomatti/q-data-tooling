import type { FilingsApi } from '../../components/filings/logic.ts';

import { useEffect, useState } from 'react';

import { companies, messageOf, type CompanyPage, type CompanyQuery } from '../../api.ts';
import { FilingsDialog } from '../../components/filings/index.tsx';
import { pageCountOf } from '../../components/pager.tsx';

import {
  INITIAL_QUERY,
  SEARCH_DEBOUNCE_MS,
  withCompany,
  withSearch,
  withSelectedOnly,
  type CompaniesApi,
} from './logic.ts';
import { CompaniesView } from './view.tsx';

/** The props of {@link CompaniesPage}. */
export interface CompaniesPageProps {
  /** The server calls. Defaults to the real ones; tests inject a fake. */
  readonly api?: CompaniesApi
  /** The first page, for a render with no server. */
  readonly initial?: CompanyPage
  /** Called with the ticker whose filings view the page opens, after the page opens it. */
  readonly onOpenFilings?: (ticker: string) => void
  /** The filings view's server call. Defaults to the real one; tests inject a fake. */
  readonly filingsApi?: FilingsApi
}

/**
 * The Companies page: holds the search text, the query it debounces into, and the last answer of
 * `GET /api/companies`, and fetches again whenever the query changes. An answer that arrives
 * after a newer query was sent is dropped. A row's switch sends `PATCH /api/companies/:ticker`
 * with the switch's next state as an explicit boolean, and the server's answer replaces the row.
 * A row's name opens the filings view for its ticker, and closing the view clears the ticker.
 *
 * @param props - The server calls, the first page and the filings handler, as
 *   {@link CompaniesPageProps} lists them.
 * @returns The page.
 */
export function CompaniesPage({ api = companies, initial, onOpenFilings, filingsApi }: CompaniesPageProps) {
  const [filingsTicker, setFilingsTicker] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<CompanyQuery>(INITIAL_QUERY);
  const [result, setResult] = useState<CompanyPage | undefined>(initial);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    // The debounce: each keystroke clears the timer the one before it set.
    const timer = setTimeout(() => setQuery((current) => withSearch(current, search)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let stale = false;
    // Fire-and-forget: both outcomes are handled in `then`, and a stale answer is dropped.
    void api.list(query).then(
      (next) => {
        if (stale) return;
        setResult(next);
        setError(undefined);
      },
      (failure: unknown) => {
        if (!stale) setError(messageOf(failure, 'could not load the companies'));
      },
    );
    return () => {
      stale = true;
    };
  }, [api, query]);

  const onSelectedChange = (ticker: string, selected: boolean): void => {
    // Fire-and-forget from a click handler: both outcomes are handled in `then`.
    void api.select(ticker, selected).then(
      (company) => {
        setResult((current) => current && withCompany(current, company));
        setError(undefined);
      },
      (failure: unknown) => setError(messageOf(failure, `could not update ${ticker}`)),
    );
  };

  const openFilings = (ticker: string): void => {
    setFilingsTicker(ticker);
    onOpenFilings?.(ticker);
  };

  const total = result?.total ?? 0;
  return (
    <>
      <CompaniesView
        result={result}
        error={error}
        search={search}
        selectedOnly={query.selectedOnly}
        page={query.page}
        pageCount={pageCountOf(total, query.pageSize)}
        onSearchChange={setSearch}
        onSelectedOnlyChange={(next) => setQuery((current) => withSelectedOnly(current, next))}
        onPageChange={(next) => setQuery((current) => ({ ...current, page: next }))}
        onOpenFilings={openFilings}
        onSelectedChange={onSelectedChange}
      />
      <FilingsDialog ticker={filingsTicker} onClose={() => setFilingsTicker(undefined)} api={filingsApi} />
    </>
  );
}
