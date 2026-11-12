import type { FormBucket } from '../../../entities/filing.ts';
import type { CompanySummary } from '../../api.ts';
import type { BarSeries, ChartTone } from '@open-tomato/charts';

import { echartsEngine } from '@open-tomato/charts';
import { SectionCard } from '@open-tomato/components';

import { FORM_BUCKETS, FORM_LABELS } from '../../components/filings/logic.ts';

/** The title of the card holding the chart of filings per company. */
export const FILINGS_CHART_TITLE = 'Filings per company';

/** What the chart of filings per company reads to assistive tech. */
export const FILINGS_CHART_LABEL = 'Filings per company in the last year, stacked by form';

/**
 * The colour of each bucket's stack, a series tone the app's stylesheet defines. `other` takes
 * `series-7`, the grey of secondary text, so the forms the app names stand out over it.
 */
export const FORM_TONES: Readonly<Record<FormBucket, ChartTone>> = {
  '10-K': 'series-1',
  '10-Q': 'series-2',
  '8-K': 'series-3',
  '6-K': 'series-4',
  '4': 'series-5',
  '144': 'series-6',
  other: 'series-7',
};

/** The chart's input: one category per company and one series per bucket. */
export interface FilingsChartData {
  /** The companies' tickers, in the order the summary lists them. */
  readonly categories: readonly string[]
  /** One series per entry of `FORM_BUCKETS`, in its order, each one count per company. */
  readonly series: readonly BarSeries[]
}

/**
 * The stacked bar chart's data over the companies of the summary: a company per category, keyed
 * by ticker, and a series per bucket under its label, so each bar stacks the company's counts by
 * form, `Other` on top.
 *
 * @param companies - The selected companies' summaries.
 * @returns The categories and the series, for the library's `BarChart`.
 */
export function filingsChartData(companies: readonly CompanySummary[]): FilingsChartData {
  return {
    categories: companies.map((company) => company.ticker),
    series: FORM_BUCKETS.map((form) => ({
      id: form,
      label: FORM_LABELS[form],
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
 * `stacked` mode, one bar per selected company and one stack per bucket. The chart takes
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
