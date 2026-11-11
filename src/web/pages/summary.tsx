import type { TrackedForm } from '../../entities/filing.ts';
import type { BarSeries, ChartTone } from '@open-tomato/charts';
import type { Column } from '@open-tomato/components';

import { echartsEngine } from '@open-tomato/charts';
import { Badge, Banner, Button, ConfirmPopover, Content, EmptyState, SectionCard, SmallStatCard, Table } from '@open-tomato/components';
import { useEffect, useState } from 'react';

import { companies, summary, type Company, type CompanySummary, type SummaryPage } from '../api.ts';
import { FilingsDialog, TRACKED_FORMS, type FilingsApi } from '../components/filings-view.tsx';

/** The Summary page's heading, which is also its nav label. */
export const SUMMARY_TITLE = 'Summary';

/** What the Summary page's empty state says while the summary holds no company. */
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

/** The label of a summary row's button that takes the company out of the summary. */
export const REMOVE_LABEL = 'Remove';

/** The confirm button of the Remove popover, naming the action again. */
export const REMOVE_CONFIRM_LABEL = 'Yes, remove';

/**
 * The question the Remove popover asks, naming the company and the action.
 *
 * @param name - The company's name, such as `Apple Inc.`.
 * @returns The question, such as `Remove Apple Inc. from the summary?`.
 */
export function removeMessage(name: string): string {
  return `Remove ${name} from the summary?`;
}

/** What a summary row asks of its page: open the company's filings, or take it out of the summary. */
export interface SummaryRowHandlers {
  /** Opens the filings of the company with the ticker. */
  readonly onOpenFilings?: (ticker: string) => void
  /** Takes the company with the ticker out of the summary, once the reader confirmed it. */
  readonly onRemove?: (ticker: string) => void
}

/**
 * The summary table's columns, in order: the ticker as a `Badge`, the name as a `ghost` `Button`
 * that opens the company's filings, one count per entry of `TRACKED_FORMS`, and last a Remove
 * button behind a `ConfirmPopover`, so the company leaves the summary only once confirmed.
 *
 * @param handlers - The row handlers, as {@link SummaryRowHandlers} lists them.
 * @returns The columns, for the library's `Table`.
 */
export function summaryColumns({ onOpenFilings, onRemove }: SummaryRowHandlers = {}): Column<CompanySummary>[] {
  const formColumns = TRACKED_FORMS.map((form): Column<CompanySummary> => ({
    key: form,
    header: form,
    align: 'end',
    sortable: true,
    sortAccessor: (company) => company.counts[form],
    cell: (company) => company.counts[form],
  }));
  return [
    {
      key: 'ticker',
      header: 'Ticker',
      sortable: true,
      cell: (company) => <Badge tone="neutral">{company.ticker}</Badge>,
    },
    {
      key: 'name',
      header: 'Company',
      sortable: true,
      cell: (company) => (
        <Button variant="ghost" size="sm" onClick={() => onOpenFilings?.(company.ticker)}>
          {company.name}
        </Button>
      ),
    },
    ...formColumns,
    {
      key: 'remove',
      header: '',
      align: 'end',
      cell: (company) => (
        <ConfirmPopover
          message={removeMessage(company.name)}
          confirmLabel={REMOVE_CONFIRM_LABEL}
          danger
          align="end"
          onConfirm={() => onRemove?.(company.ticker)}
        >
          <Button variant="secondary" size="sm">
            {REMOVE_LABEL}
          </Button>
        </ConfirmPopover>
      ),
    },
  ];
}

/** The props of {@link SummaryTable}: the companies and the row handlers. */
export interface SummaryTableProps extends SummaryRowHandlers {
  /** The selected companies' summaries, one row each. */
  readonly companies: readonly CompanySummary[]
}

/**
 * The Summary page's table, the library's `Table` over {@link summaryColumns}, one row per
 * selected company keyed by ticker.
 *
 * @param props - The companies and the handlers, as {@link SummaryTableProps} lists them.
 * @returns The table.
 */
export function SummaryTable({ companies: rows, onOpenFilings, onRemove }: SummaryTableProps) {
  return <Table columns={summaryColumns({ onOpenFilings, onRemove })} data={rows} getRowId={(company) => company.ticker} />;
}

/** The title of the card holding the chart of filings per company. */
export const FILINGS_CHART_TITLE = 'Filings per company';

/** What the chart of filings per company reads to assistive tech. */
export const FILINGS_CHART_LABEL = 'Filings per company in the last year, stacked by form';

/** The colour of each tracked form's stack, a series tone the app's stylesheet defines. */
export const FORM_TONES: Readonly<Record<TrackedForm, ChartTone>> = {
  '10-K': 'series-1',
  '10-Q': 'series-2',
  '8-K': 'series-3',
};

/** The chart's input: one category per company and one series per tracked form. */
export interface FilingsChartData {
  /** The companies' tickers, in the order the summary lists them. */
  readonly categories: readonly string[]
  /** One series per entry of `TRACKED_FORMS`, in its order, each one count per company. */
  readonly series: readonly BarSeries[]
}

/**
 * The stacked bar chart's data over the companies of the summary: a company per category, keyed
 * by ticker, and a series per tracked form, so each bar stacks the company's counts by form.
 *
 * @param companies - The selected companies' summaries.
 * @returns The categories and the series, for the library's `BarChart`.
 */
export function filingsChartData(companies: readonly CompanySummary[]): FilingsChartData {
  return {
    categories: companies.map((company) => company.ticker),
    series: TRACKED_FORMS.map((form) => ({
      id: form,
      label: form,
      tone: FORM_TONES[form],
      values: companies.map((company) => company.counts[form]),
    })),
  };
}

const { BarChart } = echartsEngine;

/** The props of {@link SummaryChart}. */
export interface SummaryChartProps {
  /** The selected companies' summaries, one bar each. */
  readonly companies: readonly CompanySummary[]
}

/**
 * The Summary page's chart: a `SectionCard` holding the `@open-tomato/charts` `BarChart` in
 * `stacked` mode, one bar per selected company and one stack per tracked form. The chart takes
 * the ECharts engine straight from `echartsEngine`, so no `ChartEngineProvider` wraps the app.
 *
 * @param props - The companies, as {@link SummaryChartProps} lists them.
 * @returns The chart card.
 */
export function SummaryChart({ companies: rows }: SummaryChartProps) {
  const { categories, series } = filingsChartData(rows);
  return (
    <SectionCard title={FILINGS_CHART_TITLE}>
      <BarChart ariaLabel={FILINGS_CHART_LABEL} categories={categories} series={series} mode="stacked" />
    </SectionCard>
  );
}

/**
 * The summary with one company taken out, matched by ticker, and its total one less. A ticker
 * the summary does not hold leaves the same object, so React skips the render.
 *
 * @param page - The summary the page holds.
 * @param ticker - The ticker of the company that left the summary.
 * @returns The summary to show next.
 */
export function withoutCompany(page: SummaryPage, ticker: string): SummaryPage {
  const items = page.items.filter((company) => company.ticker !== ticker);
  return items.length === page.items.length
    ? page
    : { ...page, items, total: Math.max(0, page.total - 1) };
}

/** The props of {@link SummaryView}. */
export interface SummaryViewProps extends SummaryRowHandlers {
  /** The summary the page holds; `undefined` before the first answer. */
  readonly result?: SummaryPage
  /** Why the last fetch or removal failed, shown above the page's content. */
  readonly error?: string
}

/**
 * The Summary page as a pure view: a page header titled {@link SUMMARY_TITLE}, the stat cards
 * once a summary is held, a `Banner` with a failed fetch's or removal's message, the
 * {@link SummaryTable} and the {@link SummaryChart} below it while the summary lists a company,
 * and the library's `EmptyState` while it lists none. The library has no page-header component, so the header is an `h1` in a `Content`
 * row. Pure: it holds no state and calls no API.
 *
 * @param props - The summary, the failure and the row handlers, as {@link SummaryViewProps} lists them.
 * @returns The page.
 */
export function SummaryView({ result, error, onOpenFilings, onRemove }: SummaryViewProps = {}) {
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
      {items.length > 0 && <SummaryTable companies={items} onOpenFilings={onOpenFilings} onRemove={onRemove} />}
      {items.length > 0 && <SummaryChart companies={items} />}
      {items.length === 0 && <EmptyState title={SUMMARY_EMPTY_TITLE} description={SUMMARY_EMPTY_DESCRIPTION} />}
    </Content>
  );
}

/** What the Summary page needs from the server; the real one by default, a stand-in in tests. */
export interface SummaryApi {
  /** One page of the selected companies' summaries. */
  list(page: number, pageSize: number): Promise<SummaryPage>
}

/** What the Summary page's Remove needs from the server; the real Companies client by default. */
export interface RemoveApi {
  /** Sets the company in or out of the summary, with the explicit flag, and answers it as it stands. */
  select(ticker: string, selected: boolean): Promise<Company>
}

/** The props of {@link SummaryPage}. */
export interface SummaryPageProps {
  /** The server call. Defaults to the real one; tests inject a fake. */
  readonly api?: SummaryApi
  /** The first summary, for a render with no server. */
  readonly initial?: SummaryPage
  /** The Remove's server call, `PATCH /api/companies/:ticker`. Defaults to the real one; tests inject a fake. */
  readonly removeApi?: RemoveApi
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
 * The Summary page at `/summary`: fetches `GET /api/filings/summary` once, up to
 * {@link SUMMARY_PAGE_SIZE} companies, and shows the filings of the selected companies. The route
 * reads the database only, so the page never triggers an SEC call. A failed fetch shows its
 * message and leaves the page on what it held. A row's confirmed Remove sends
 * `PATCH /api/companies/:ticker` with `selected: false`, never a toggle, and the row leaves the
 * table once the server answers; a refusal shows its message and keeps the row. A row's name
 * opens the filings view for its ticker, and closing the view clears the ticker.
 *
 * @param props - The server calls, the first summary and the filings handler, as
 *   {@link SummaryPageProps} lists them.
 * @returns The page.
 */
export function SummaryPage({ api = summary, initial, removeApi = companies, onOpenFilings, filingsApi }: SummaryPageProps = {}) {
  const [filingsTicker, setFilingsTicker] = useState<string | undefined>();
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
        if (!stale) setError(messageOf(failure, 'could not load the summary'));
      },
    );
    return () => {
      stale = true;
    };
  }, [api]);

  const onRemove = (ticker: string): void => {
    // Fire-and-forget from a click handler: both outcomes are handled in `then`.
    void removeApi.select(ticker, false).then(
      () => {
        setResult((current) => current && withoutCompany(current, ticker));
        setError(undefined);
      },
      (failure: unknown) => setError(messageOf(failure, `could not remove ${ticker}`)),
    );
  };

  const openFilings = (ticker: string): void => {
    setFilingsTicker(ticker);
    onOpenFilings?.(ticker);
  };

  return (
    <>
      <SummaryView result={result} error={error} onOpenFilings={openFilings} onRemove={onRemove} />
      <FilingsDialog ticker={filingsTicker} onClose={() => setFilingsTicker(undefined)} api={filingsApi} />
    </>
  );
}
