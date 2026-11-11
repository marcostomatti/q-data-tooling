import { z } from 'zod';

import { Company } from '../../entities/company.ts';
import { Filing, FilingLinks, TrackedForm } from '../../entities/filing.ts';
import { pageOf, PaginationQuery, Ticker } from '../common.ts';

/** The domain every line of `filing_list` and `filing_summary` carries, bound by both transport files. */
export const DOMAIN = 'Filings';

/** The order of a company's filings: by `filingDate`, oldest first, or newest first with the leading `-`. */
export const FilingSort = z.enum(['filingDate', '-filingDate']);

/** One of the orders {@link FilingSort} names. */
export type FilingSort = z.infer<typeof FilingSort>;

/**
 * The input of `filing_list`, `GET /companies/:ticker/filings`: the paging fields, the ticker
 * from the path, upper cased, `form` to keep only the filings of one base form, amendments
 * included, and `sort`, newest first by default. Strict, so a stray field is refused.
 */
export const FilingListInput = PaginationQuery.extend({
  /** The ticker from the path, upper cased. */
  ticker: Ticker,
  /** The base form to keep, amendments included; every tracked form when absent. */
  form: TrackedForm.optional(),
  /** The order of the filings, newest first by default. */
  sort: FilingSort.default('-filingDate'),
});

/** The parsed input of `filing_list`, as {@link FilingListInput} reads it. */
export type FilingListInput = z.infer<typeof FilingListInput>;

/** What `filing_list` answers: the company the ticker names, and one page of its filings. */
export const FilingListOutput = z.strictObject({
  /** The company the ticker names. */
  company: Company,
  /** One page of the company's filings. */
  filings: pageOf(Filing),
});

/** The company and one page of its filings, as {@link FilingListOutput} parses it. */
export type FilingListOutput = z.infer<typeof FilingListOutput>;

/**
 * The input of `filing_summary`, `GET /filings/summary`: the paging fields, and `form` to narrow
 * the summary to one base form. Strict, so a stray field is refused.
 */
export const SummaryInput = PaginationQuery.extend({
  /** The base form to narrow the counts to; every tracked form when absent. */
  form: TrackedForm.optional(),
});

/** The parsed input of `filing_summary`, as {@link SummaryInput} reads it. */
export type SummaryInput = z.infer<typeof SummaryInput>;

/**
 * One company of the summary: its name, ticker and CIK, its count of filings per tracked form
 * and in total, the filing date and links of its latest 10-K, or `null` when it filed none in
 * the last year, and when its filings were last synced.
 */
export const CompanySummary = z.strictObject({
  /** The company's SEC Central Index Key. */
  cik: z.number().int(),
  /** The company's ticker, upper case. */
  ticker: z.string(),
  /** The company's name as SEC lists it. */
  name: z.string(),
  /** The company's filings in the last year, per tracked form, amendments included, and in total. */
  counts: z.strictObject({
    /** The count of 10-K filings. */
    '10-K': z.number(),
    /** The count of 10-Q filings. */
    '10-Q': z.number(),
    /** The count of 8-K filings. */
    '8-K': z.number(),
    /** The count across every tracked form. */
    total: z.number(),
  }),
  /** The latest 10-K's filing date and links, or `null` when the company filed none in the last year. */
  latest10K: z.strictObject({
    /** The filing date, `YYYY-MM-DD`. */
    filingDate: z.string(),
    /** The SEC links of the filing. */
    links: FilingLinks,
  }).nullable(),
  /** When the company's filings were last synced, or `null` before the first sync. */
  filingsSyncedAt: z.string().nullable(),
});

/** One company of the summary, as {@link CompanySummary} parses it. */
export type CompanySummary = z.infer<typeof CompanySummary>;

/** What `filing_summary` answers: one page of the selected companies' summaries and the total across every page. */
export const SummaryOutput = pageOf(CompanySummary);

/** One page of company summaries, as {@link SummaryOutput} parses it. */
export type SummaryOutput = z.infer<typeof SummaryOutput>;
