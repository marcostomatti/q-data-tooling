import {
  Banner,
  Button,
  Checkbox,
  Content,
  EmptyState,
  SearchInput,
  Toolbar,
  ToolbarControls,
  ToolbarSep,
  ToolbarSummary,
} from '@open-tomato/components';
import { useEffect, useState } from 'react';

import { companies, type CompanyPage, type CompanyQuery } from '../api.ts';

/** The Companies page's heading, the same text as its nav entry's label. */
export const COMPANIES_TITLE = 'Companies';

/** What the Companies page's empty state says while the page lists no companies yet. */
export const COMPANIES_EMPTY_TITLE = 'No companies yet';

/** What the Companies page's empty state tells the reader the page will hold. */
export const COMPANIES_EMPTY_DESCRIPTION = 'The tracked companies will be listed here.';

/** The label of the toolbar's filter that keeps only the companies in the summary. */
export const SELECTED_ONLY_LABEL = 'Selected only';

/** How long the search waits after the last keystroke before it asks the server, in milliseconds. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The companies one page holds, the route's own default page size. */
export const COMPANIES_PAGE_SIZE = 25;

/** The query the page opens on: the first page, no search, every company. */
export const INITIAL_QUERY: CompanyQuery = { page: 1, pageSize: COMPANIES_PAGE_SIZE, q: '', selectedOnly: false };

/** What the Companies page needs from the server; the real one by default, a stand-in in tests. */
export interface CompaniesApi {
  list(query: CompanyQuery): Promise<CompanyPage>
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

/**
 * How many pages a total spans, at least one, so an empty result still reads `Page 1 of 1`.
 *
 * @param total - The count of matching companies across every page.
 * @param pageSize - The most companies one page holds.
 * @returns The page count, from 1.
 */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The props of {@link CompaniesToolbar}. */
export interface CompaniesToolbarProps {
  /** The search text as typed, ahead of the debounce. */
  readonly search: string
  readonly selectedOnly: boolean
  /** The page shown, from 1. */
  readonly page: number
  /** The page count, from 1. */
  readonly pageCount: number
  /** The count of matching companies across every page. */
  readonly total: number
  readonly onSearchChange?: (text: string) => void
  readonly onSelectedOnlyChange?: (selectedOnly: boolean) => void
  /** Asks for another page, from 1. */
  readonly onPageChange?: (page: number) => void
}

/**
 * The control bar over the company list: the search, the selected-only filter, and Previous and
 * Next buttons around `Page n of N`. The library's `Pagination` draws one button per page, which
 * the full ticker list would turn into hundreds, so the bar steps a page at a time instead.
 *
 * @param props - The bar's values and handlers, as {@link CompaniesToolbarProps} lists them.
 * @returns The toolbar.
 */
export function CompaniesToolbar(props: CompaniesToolbarProps) {
  const { search, selectedOnly, page, pageCount, total, onSearchChange, onSelectedOnlyChange, onPageChange } = props;
  return (
    <Toolbar>
      <ToolbarControls>
        <SearchInput
          aria-label="Search companies"
          placeholder="Ticker or name…"
          value={search}
          onChange={(text: string) => onSearchChange?.(text)}
        />
        <ToolbarSep />
        <Checkbox label={SELECTED_ONLY_LABEL} checked={selectedOnly} onChange={(next: boolean) => onSelectedOnlyChange?.(next)} />
      </ToolbarControls>
      <ToolbarSummary>
        <span>{total === 1
          ? '1 company'
          : `${total} companies`}
        </span>
        <Content direction="row" align="center" gap="sm">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
            Previous
          </Button>
          <span>{`Page ${page} of ${pageCount}`}</span>
          <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPageChange?.(page + 1)}>
            Next
          </Button>
        </Content>
      </ToolbarSummary>
    </Toolbar>
  );
}

/** The props of {@link CompaniesView}: the toolbar's, plus the page of companies and the last failure. */
export interface CompaniesViewProps extends Partial<CompaniesToolbarProps> {
  /** The page of companies the server answered, unset before the first answer. */
  readonly result?: CompanyPage
  /** Why the last load failed, shown as an alert in place of the empty state. */
  readonly error?: string
}

/**
 * The Companies page as a pure view: a page header titled {@link COMPANIES_TITLE}, the
 * {@link CompaniesToolbar}, an alert when the last load failed, and the library's `EmptyState`
 * while the page holds no company. The library has no page-header component, so the header is
 * an `h1` in a `Content` row. Pure: it holds no state and calls no API.
 *
 * @param props - The view's values and handlers, as {@link CompaniesViewProps} lists them.
 * @returns The page.
 */
export function CompaniesView(props: CompaniesViewProps) {
  const { result, error, search = '', selectedOnly = false } = props;
  const total = result?.total ?? 0;
  const page = props.page ?? result?.page ?? 1;
  const pageCount = props.pageCount ?? pageCountOf(total, result?.pageSize ?? COMPANIES_PAGE_SIZE);
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="between">
        <h1>{COMPANIES_TITLE}</h1>
      </Content>
      <CompaniesToolbar
        {...props}
        search={search}
        selectedOnly={selectedOnly}
        page={page}
        pageCount={pageCount}
        total={total}
      />
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {error === undefined && total === 0 && <EmptyState title={COMPANIES_EMPTY_TITLE} description={COMPANIES_EMPTY_DESCRIPTION} />}
    </Content>
  );
}

/** The props of {@link CompaniesPage}. */
export interface CompaniesPageProps {
  /** The server calls. Defaults to the real ones; tests inject a fake. */
  readonly api?: CompaniesApi
  /** The first page, for a render with no server. */
  readonly initial?: CompanyPage
}

function messageOf(failure: unknown): string {
  return failure instanceof Error
    ? failure.message
    : 'could not load the companies';
}

/**
 * The Companies page: holds the search text, the query it debounces into, and the last answer of
 * `GET /api/companies`, and fetches again whenever the query changes. An answer that arrives
 * after a newer query was sent is dropped.
 *
 * @param props - The server calls and the first page, as {@link CompaniesPageProps} lists them.
 * @returns The page.
 */
export function CompaniesPage({ api = companies, initial }: CompaniesPageProps) {
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
        if (!stale) setError(messageOf(failure));
      },
    );
    return () => {
      stale = true;
    };
  }, [api, query]);

  const total = result?.total ?? 0;
  return (
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
    />
  );
}
