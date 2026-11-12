import { z } from 'zod';

import { Company } from '../../entities/company.ts';
import { Filing, FilingLinks, FormBucket } from '../../entities/filing.ts';
import { pageOf, PaginationQuery, Ticker } from '../common.ts';

/** The domain every line of `filing_list` and `filing_summary` carries, bound by both transport files. */
export const DOMAIN = 'Filings';

/** The order of a company's filings: by `filingDate`, oldest first, or newest first with the leading `-`. */
export const FilingSort = z.enum(['filingDate', '-filingDate']);

/** One of the orders {@link FilingSort} names. */
export type FilingSort = z.infer<typeof FilingSort>;

/**
 * The input of `filing_list`, `GET /companies/:ticker/filings`: the paging fields, the ticker
 * from the path, upper cased, `form` to keep only the filings of one bucket, a named base form
 * with its amendments or `other` for every other form, and `sort`, newest first by default. Strict, so a stray field is refused.
 */
export const FilingListInput = PaginationQuery.extend({
  /** The ticker from the path, upper cased. */
  ticker: Ticker,
  /** The bucket to keep: a named base form, amendments included, or `other`; every form when absent. */
  form: FormBucket.optional(),
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
 * the summary to one bucket, a named base form or `other`. Strict, so a stray field is refused.
 */
export const SummaryInput = PaginationQuery.extend({
  /** The bucket to narrow the counts to; every form when absent. */
  form: FormBucket.optional(),
});

/** A count of filings in one bucket. */
const BucketCount = z.number();

/** The filing date of a bucket's newest filing, `YYYY-MM-DD`, or `null` when there is none. */
const BucketDate = z.string().nullable();

/** The parsed input of `filing_summary`, as {@link SummaryInput} reads it. */
export type SummaryInput = z.infer<typeof SummaryInput>;

/**
 * One company of the summary: its name, ticker and CIK, its count of filings per bucket and in
 * total, the filing date of its newest filing per bucket, the filing date and links
 * of its latest 10-K, or `null` when it filed none in the last year, and when its filings were
 * last synced.
 */
export const CompanySummary = z.strictObject({
  /** The company's SEC Central Index Key. */
  cik: z.number().int(),
  /** The company's ticker, upper case. */
  ticker: z.string(),
  /** The company's name as SEC lists it. */
  name: z.string(),
  /** The company's filings in the last year, per bucket, amendments included, and in total. */
  counts: z.strictObject({
    /** The count of 10-K filings, the annual report. */
    '10-K': BucketCount,
    /** The count of 10-Q filings, the quarterly report. */
    '10-Q': BucketCount,
    /** The count of 8-K filings, the current report. */
    '8-K': BucketCount,
    /** The count of 6-K filings, a foreign issuer's current report. */
    '6-K': BucketCount,
    /** The count of Form 4 filings, an insider's trade. */
    '4': BucketCount,
    /** The count of Form 144 filings, a notice of a planned sale of restricted stock. */
    '144': BucketCount,
    /** The count of every other form, such as SCHEDULE 13G or 424B2. */
    other: BucketCount,
    /** The count across every bucket. */
    total: BucketCount,
  }),
  /** The filing date of the newest filing per bucket, amendments included, or `null` for a bucket it filed none of. */
  lastFiled: z.strictObject({
    /** The newest 10-K's filing date. */
    '10-K': BucketDate,
    /** The newest 10-Q's filing date. */
    '10-Q': BucketDate,
    /** The newest 8-K's filing date. */
    '8-K': BucketDate,
    /** The newest 6-K's filing date. */
    '6-K': BucketDate,
    /** The newest Form 4's filing date. */
    '4': BucketDate,
    /** The newest Form 144's filing date. */
    '144': BucketDate,
    /** The newest filing date of any other form. */
    other: BucketDate,
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
