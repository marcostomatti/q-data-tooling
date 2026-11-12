import type { FormBucket } from '../../../entities/filing.ts';
import type { Company, CompanySummary, SummaryPage } from '../../api.ts';

import { FORM_BUCKETS } from '../../components/filings/logic.ts';

/** The Summary page's nav label, which the shell's topbar shows as the page's title. */
export const SUMMARY_TITLE = 'Summary';

/** Where the Summary page lives: the app's landing path, `APP.landing.path`. */
export const SUMMARY_PATH = '/summary';

/** What the Summary page's empty state says while the summary holds no company. */
export const SUMMARY_EMPTY_TITLE = 'Nothing here yet';

/** What the Summary page will show, as its empty state tells the reader. */
export const SUMMARY_EMPTY_DESCRIPTION = 'The filings of the selected companies, summed up by form.';

/** Where the Companies page lives, the target of the empty state's pointer. */
export const COMPANIES_PATH = '/companies';

/** The label of the empty state's button to the Companies page. */
export const COMPANIES_LINK_LABEL = 'Select companies on the Companies page';

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

/** The title of the stat card naming the selected company with the most filings in the last year. */
export const MOST_FILINGS_TITLE = 'Most filings';

/** The title of the stat card holding the newest filing of any form across the selected companies. */
export const NEWEST_FILING_TITLE = 'Newest filing';

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

/** The newest filing of any form: the company that filed it, its date and its bucket. */
export interface NewestFiling extends LatestFiling {
  /** The bucket the filing counts under, such as `4` or `other`. */
  readonly form: FormBucket
}

/** The selected company with the most filings in the last year, and that count. */
export interface BusiestCompany {
  /** The company's ticker. */
  readonly ticker: string
  /** Its filings in the last year, every form. */
  readonly total: number
}

/** The figures of the Summary page's stat cards. */
export interface SummaryStats {
  /** The filings of every selected company in the last year, every form. */
  readonly totalFilings: number
  /** {@link SummaryStats.totalFilings} over the count of companies, to one decimal; 0 with none. */
  readonly averagePerCompany: number
  /** The company with the most filings, or `undefined` when none filed anything. */
  readonly busiest: BusiestCompany | undefined
  /** The newest filing of any form, or `undefined` when none filed anything. */
  readonly newest: NewestFiling | undefined
  /** The latest 10-K, or `undefined` when no company filed one in the last year. */
  readonly latest: LatestFiling | undefined
}

/** The busier of two: a tie keeps the company listed first, and a company with no filings is never the busiest. */
function busierOf(busiest: BusiestCompany | undefined, company: CompanySummary): BusiestCompany | undefined {
  const total = company.counts.total;
  if (total === 0 || (busiest !== undefined && busiest.total >= total)) return busiest;
  return { ticker: company.ticker, total };
}

/** The company's newest filing date per bucket, one entry per bucket it filed in. */
function newestPerBucket(company: CompanySummary): readonly NewestFiling[] {
  return FORM_BUCKETS.flatMap((form) => {
    const filingDate = company.lastFiled[form];
    return filingDate === null
      ? []
      : [{ ticker: company.ticker, filingDate, form }];
  });
}

/** The newer of two filings; a tie keeps the one met first. */
function newerOf(newest: NewestFiling | undefined, filing: NewestFiling): NewestFiling {
  return newest !== undefined && newest.filingDate >= filing.filingDate
    ? newest
    : filing;
}

function laterOf(latest: LatestFiling | undefined, company: CompanySummary): LatestFiling | undefined {
  const filing = company.latest10K;
  if (filing === null) return latest;
  return latest !== undefined && latest.filingDate >= filing.filingDate
    ? latest
    : { ticker: company.ticker, filingDate: filing.filingDate };
}

/**
 * The stat cards' figures over the companies of the summary, read from the counts and dates the
 * summary already carries, so no filing is opened. Filing dates are `YYYY-MM-DD`, so the latest
 * is the greatest string; a tie keeps the company listed first, and within one company the
 * bucket listed first in `FORM_BUCKETS`.
 *
 * @param companies - The selected companies' summaries.
 * @returns The total, the average per company, the busiest company, the newest filing of any
 *   form and the latest 10-K.
 */
export function summaryStats(companies: readonly CompanySummary[]): SummaryStats {
  const totalFilings = companies.reduce((sum, company) => sum + company.counts.total, 0);
  const averagePerCompany = companies.length === 0
    ? 0
    : Math.round((totalFilings / companies.length) * 10) / 10;
  const busiest = companies.reduce<BusiestCompany | undefined>(busierOf, undefined);
  const newest = companies.flatMap(newestPerBucket).reduce<NewestFiling | undefined>(newerOf, undefined);
  const latest = companies.reduce<LatestFiling | undefined>(laterOf, undefined);
  return { totalFilings, averagePerCompany, busiest, newest, latest };
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
