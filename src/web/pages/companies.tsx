import {
  Banner,
  Button,
  Checkbox,
  Content,
  EmptyState,
  RowStatCard,
  SearchInput,
  Switch,
  Toolbar,
  ToolbarControls,
  ToolbarSep,
  ToolbarSummary,
} from '@open-tomato/components';
import { useEffect, useState } from 'react';

import { companies, type Company, type CompanyPage, type CompanyQuery } from '../api.ts';
import { FilingsDialog, type FilingsApi } from '../components/filings-view.tsx';

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

/** What a company row asks of its page: open the company's filings, or set it in the summary. */
export interface CompanyRowHandlers {
  /** Opens the filings of the company with the ticker; the Filings view wires it. */
  readonly onOpenFilings?: (ticker: string) => void
  /** Sets the company with the ticker in or out of the summary, with the switch's next state. */
  readonly onSelectedChange?: (ticker: string, selected: boolean) => void
}

/** The props of {@link CompanyRow}: the company and the row's handlers. */
export interface CompanyRowProps extends CompanyRowHandlers {
  readonly company: Company
}

/**
 * One company as the library's `RowStatCard`, after its stats-only story: the ticker as the
 * title, the name as a `ghost` `Button` that opens the filings, three ministats (the CIK, the
 * exchanges and the day of the last sync) and a `Switch` on the right that sets the company in
 * the summary. The card's `title` takes only a string, so the name button sits in `subtitle`;
 * `DecoratedToggle` and `OptionCard` were passed over because each draws its whole body as one
 * `<button>`, which a `Button` inside would nest in.
 *
 * @param props - The company and the handlers, as {@link CompanyRowProps} lists them.
 * @returns The card.
 */
export function CompanyRow({ company, onOpenFilings, onSelectedChange }: CompanyRowProps) {
  const exchanges = company.exchanges.join(', ');
  return (
    <RowStatCard
      title={company.ticker}
      subtitle={(
        <Button variant="ghost" size="sm" onClick={() => onOpenFilings?.(company.ticker)}>
          {company.name}
        </Button>
      )}
      stats={[
        { title: 'cik', value: company.cik },
        exchanges.length > 0
          ? { title: 'exchange', value: exchanges }
          : { title: 'exchange', value: NO_EXCHANGE, tone: 'muted' },
        company.filingsSyncedAt === null
          ? { title: 'synced', value: NOT_SYNCED, tone: 'muted' }
          : { title: 'synced', value: company.filingsSyncedAt.slice(0, 10) },
      ]}
      action={(
        <Switch
          aria-label={`Show ${company.name} in the summary`}
          checked={company.selected}
          onChange={(next: boolean) => onSelectedChange?.(company.ticker, next)}
        />
      )}
    />
  );
}

/** The props of {@link CompaniesView}: the toolbar's and the rows' handlers, the page of companies and the last failure. */
export interface CompaniesViewProps extends Partial<CompaniesToolbarProps>, CompanyRowHandlers {
  /** The page of companies the server answered, unset before the first answer. */
  readonly result?: CompanyPage
  /** Why the last load or change failed, shown as an alert in place of the empty state. */
  readonly error?: string
}

/**
 * The Companies page as a pure view: a page header titled {@link COMPANIES_TITLE}, the
 * {@link CompaniesToolbar}, an alert when the last load or change failed, one {@link CompanyRow}
 * per company on the page, and the library's `EmptyState` while the page holds no company and
 * nothing failed. The library has no page-header component, so the header is an `h1` in a
 * `Content` row. Pure: it holds no state and calls no API.
 *
 * @param props - The view's values and handlers, as {@link CompaniesViewProps} lists them.
 * @returns The page.
 */
export function CompaniesView(props: CompaniesViewProps) {
  const { result, error, search = '', selectedOnly = false, onOpenFilings, onSelectedChange } = props;
  const items = result?.items ?? [];
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
      {items.length > 0 && (
        <Content gap="sm">
          {items.map((company) => (
            <CompanyRow key={company.ticker} company={company} onOpenFilings={onOpenFilings} onSelectedChange={onSelectedChange} />
          ))}
        </Content>
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
  /** Called with the ticker whose filings view the page opens, after the page opens it. */
  readonly onOpenFilings?: (ticker: string) => void
  /** The filings view's server call. Defaults to the real one; tests inject a fake. */
  readonly filingsApi?: FilingsApi
}

function messageOf(failure: unknown, fallback: string): string {
  return failure instanceof Error
    ? failure.message
    : fallback;
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
