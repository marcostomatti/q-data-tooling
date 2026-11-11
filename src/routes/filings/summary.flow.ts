import type { CompanySummary, SummaryInput, SummaryOutput } from './contract.ts';
import type { TrackedForm } from '../../entities/filing.ts';
import type { Log } from '../../logging.ts';

import { scoped } from '../../logging.ts';

/**
 * What `summarizeFilings` asks its filings store for: the base form to narrow the summary to
 * when one is named, and the window of selected companies the page covers, `offset` rows in and
 * at most `limit` long.
 */
export interface SummaryQuery {
  /** The base form to narrow the counts to, or `undefined` for every tracked form. */
  readonly form: TrackedForm | undefined
  /** The count of selected companies to skip. */
  readonly offset: number
  /** The most summaries to return. */
  readonly limit: number
}

/** What the filings store answers for a {@link SummaryQuery}: the summaries in its window and the count of every match. */
export interface SummarySlice {
  /** The summaries in the window. */
  readonly items: readonly CompanySummary[]
  /** The count of every selected company. */
  readonly total: number
}

/**
 * What `summarizeFilings` reads: a filings store with the one method it calls, and the log its
 * transport has bound to the `Filings` domain. This stage passes the fixed stub store from
 * `stub.ts`.
 */
export interface SummarizeFilingsDeps {
  /** The filings store. */
  readonly filings: {
    /** Reads the window of selected companies' summaries the query names. */
    summary(query: SummaryQuery): Promise<SummarySlice>
  }
  /** The log bound to the `Filings` domain. */
  readonly log: Log
}

/**
 * Summarizes the filings of the companies in the summary, one page of them: each company's
 * counts per tracked form and its latest 10-K. It reads stored rows only and never calls SEC.
 *
 * Its scope is `summary`, and its one crumb is a `debug` line with step `read`: a read is routine.
 *
 * @param input - The parsed `filing_summary` input.
 * @param deps - The filings store and the domain-bound log.
 * @returns The page, with the `page` and `pageSize` asked for and the total of every selected company.
 */
export async function summarizeFilings(input: SummaryInput, deps: SummarizeFilingsDeps): Promise<SummaryOutput> {
  const log = scoped(deps.log, 'summary');
  const { page, pageSize } = input;
  const slice = await deps.filings.summary({ form: input.form, offset: (page - 1) * pageSize, limit: pageSize });
  log.debug({ step: 'read', page, pageSize, total: slice.total }, 'filings summarized');
  return { items: [...slice.items], page, pageSize, total: slice.total };
}
