import { Banner, Content, EmptyState, SmallStatCard } from '@open-tomato/components';
import { useEffect, useState } from 'react';

import { summary, type CompanySummary, type SummaryPage } from '../api.ts';

/** The Summary page's heading, which is also its nav label. */
export const SUMMARY_TITLE = 'Summary';

/** What the Summary page's empty state says before its content is built. */
export const SUMMARY_EMPTY_TITLE = 'Nothing here yet';

/** What the Summary page will show, as its empty state tells the reader. */
export const SUMMARY_EMPTY_DESCRIPTION = 'The filings of the selected companies, summed up by form.';

/** The title of the stat card holding the filings of every selected company. */
export const TOTAL_FILINGS_TITLE = 'Total filings';

/** The title of the stat card holding the average count of filings per selected company. */
export const AVERAGE_FILINGS_TITLE = 'Average per company';

/**
 * The title of the stat card holding the latest filing. The summary carries each company's latest
 * 10-K and no other filing date, so the card names the form it reads.
 */
export const LATEST_FILING_TITLE = 'Latest 10-K';

/** What the latest-filing card shows when no selected company filed a 10-K in the last year. */
export const NO_LATEST_FILING = '—';

/**
 * The companies the page asks for in one call: the route's largest page size, `PAGE_SIZE_MAX`
 * in `src/routes/common.ts`, repeated here so the bundle does not carry zod for it.
 */
export const SUMMARY_PAGE_SIZE = 100;

/** The latest 10-K across the selected companies: the company that filed it and its date. */
export interface LatestFiling {
  /** The ticker of the company that filed it. */
  readonly ticker: string
  /** The filing date, `YYYY-MM-DD`. */
  readonly filingDate: string
}

/** The figures of the Summary page's stat cards. */
export interface SummaryStats {
  /** The filings of every selected company in the last year, every tracked form. */
  readonly totalFilings: number
  /** {@link SummaryStats.totalFilings} over the count of companies, to one decimal; 0 with none. */
  readonly averagePerCompany: number
  /** The latest 10-K, or `undefined` when no company filed one in the last year. */
  readonly latest: LatestFiling | undefined
}

function laterOf(latest: LatestFiling | undefined, company: CompanySummary): LatestFiling | undefined {
  const filing = company.latest10K;
  if (filing === null) return latest;
  return latest !== undefined && latest.filingDate >= filing.filingDate
    ? latest
    : { ticker: company.ticker, filingDate: filing.filingDate };
}

/**
 * The stat cards' figures over the companies of the summary. Filing dates are `YYYY-MM-DD`, so
 * the latest is the greatest string; a tie keeps the company listed first.
 *
 * @param companies - The selected companies' summaries.
 * @returns The total, the average per company and the latest 10-K.
 */
export function summaryStats(companies: readonly CompanySummary[]): SummaryStats {
  const totalFilings = companies.reduce((sum, company) => sum + company.counts.total, 0);
  const averagePerCompany = companies.length === 0
    ? 0
    : Math.round((totalFilings / companies.length) * 10) / 10;
  const latest = companies.reduce<LatestFiling | undefined>(laterOf, undefined);
  return { totalFilings, averagePerCompany, latest };
}

/** The props of {@link SummaryStatCards}. */
export interface SummaryStatCardsProps {
  /** The figures the cards show. */
  readonly stats: SummaryStats
}

/**
 * The Summary page's top row: three compact `SmallStatCard`, the total filings of the selected
 * companies, the average per company, and the latest 10-K with the ticker that filed it.
 * The average goes in as text, because the card's number formatter rounds it to a whole number.
 *
 * @param props - The figures, as {@link SummaryStatCardsProps} lists them.
 * @returns The row of cards.
 */
export function SummaryStatCards({ stats }: SummaryStatCardsProps) {
  const { totalFilings, averagePerCompany, latest } = stats;
  return (
    <Content direction="row" gap="md">
      <SmallStatCard size="sm" title={TOTAL_FILINGS_TITLE} value={totalFilings} unit="filings" short={false} />
      <SmallStatCard size="sm" title={AVERAGE_FILINGS_TITLE} value={String(averagePerCompany)} unit="filings" />
      <SmallStatCard
        size="sm"
        title={LATEST_FILING_TITLE}
        value={latest?.filingDate ?? NO_LATEST_FILING}
        footer={latest?.ticker}
      />
    </Content>
  );
}

/** The props of {@link SummaryView}. */
export interface SummaryViewProps {
  /** The summary the page holds; `undefined` before the first answer. */
  readonly result?: SummaryPage
  /** Why the last fetch failed, shown above the page's content. */
  readonly error?: string
}

/**
 * The Summary page as a pure view: a page header titled {@link SUMMARY_TITLE}, the stat cards
 * once a summary is held, a `Banner` with a failed fetch's message, and the library's `EmptyState` while it lists no company. The library
 * has no page-header component, so the header is an `h1` in a `Content` row.
 *
 * @param props - The summary, as {@link SummaryViewProps} lists it.
 * @returns The page.
 */
export function SummaryView({ result, error }: SummaryViewProps = {}) {
  const items = result?.items ?? [];
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="between">
        <h1>{SUMMARY_TITLE}</h1>
      </Content>
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {result !== undefined && <SummaryStatCards stats={summaryStats(items)} />}
      {items.length === 0 && <EmptyState title={SUMMARY_EMPTY_TITLE} description={SUMMARY_EMPTY_DESCRIPTION} />}
    </Content>
  );
}

/** What the Summary page needs from the server; the real one by default, a stand-in in tests. */
export interface SummaryApi {
  /** One page of the selected companies' summaries. */
  list(page: number, pageSize: number): Promise<SummaryPage>
}

/** The props of {@link SummaryPage}. */
export interface SummaryPageProps {
  /** The server call. Defaults to the real one; tests inject a fake. */
  readonly api?: SummaryApi
  /** The first summary, for a render with no server. */
  readonly initial?: SummaryPage
}

/**
 * The Summary page at `/summary`: fetches `GET /api/filings/summary` once, up to
 * {@link SUMMARY_PAGE_SIZE} companies, and shows the filings of the selected companies. The route
 * reads the database only, so the page never triggers an SEC call. A failed fetch shows its
 * message and leaves the page on what it held.
 *
 * @param props - The server call and the first summary, as {@link SummaryPageProps} lists them.
 * @returns The page.
 */
export function SummaryPage({ api = summary, initial }: SummaryPageProps = {}) {
  const [result, setResult] = useState<SummaryPage | undefined>(initial);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let stale = false;
    // Fire-and-forget: both outcomes are handled in `then`, and a stale answer is dropped.
    void api.list(1, SUMMARY_PAGE_SIZE).then(
      (next) => {
        if (stale) return;
        setResult(next);
        setError(undefined);
      },
      (failure: unknown) => {
        if (!stale) setError(failure instanceof Error
          ? failure.message
          : 'could not load the summary');
      },
    );
    return () => {
      stale = true;
    };
  }, [api]);

  return <SummaryView result={result} error={error} />;
}
