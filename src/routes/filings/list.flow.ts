import type { FilingListInput, FilingListOutput, FilingSort } from './contract.ts';
import type { Company } from '../../entities/company.ts';
import type { Filing, TrackedForm } from '../../entities/filing.ts';
import type { Log } from '../../logging.ts';

import { NotFoundError } from '../../errors.ts';
import { scoped } from '../../logging.ts';

/**
 * What `listFilings` asks its filings store for: the company's CIK, the base form to keep when
 * one is named, the order, and the window of rows the page covers, `offset` rows in and at most
 * `limit` long.
 */
export interface FilingPageQuery {
  readonly cik: number
  readonly form: TrackedForm | undefined
  readonly sort: FilingSort
  readonly offset: number
  readonly limit: number
}

/** What the filings store answers for a {@link FilingPageQuery}: the rows in its window and the count of every match. */
export interface FilingSlice {
  readonly items: readonly Filing[]
  readonly total: number
}

/**
 * What `listFilings` reads: a companies store that resolves a ticker to its company, or
 * `undefined` when no company trades under it, a filings store that pages one company's filings,
 * and the log its transport has bound to the `Filings` domain. This stage passes the fixed stub
 * stores from `stub.ts`.
 */
export interface ListFilingsDeps {
  readonly companies: { findByTicker(ticker: string): Promise<Company | undefined> }
  readonly filings: { page(query: FilingPageQuery): Promise<FilingSlice> }
  readonly log: Log
}

/**
 * Lists one page of the filings of the company with the ticker, with the company itself. The
 * paging is the server's: the flow turns `page` and `pageSize` into the window the store reads.
 *
 * Its scope is `list`. The page is a `debug` line with step `read`, since a read is routine; a
 * ticker no company trades under is a `debug` line with step `resolve`, because the caller's
 * miss is not the service's failure.
 *
 * @param input - The parsed `filing_list` input, its ticker upper cased.
 * @param deps - The companies and filings stores and the domain-bound log.
 * @returns The company and the page, with the `page` and `pageSize` asked for and the total of every match.
 * @throws {NotFoundError} When no company trades under `input.ticker`.
 */
export async function listFilings(input: FilingListInput, deps: ListFilingsDeps): Promise<FilingListOutput> {
  const log = scoped(deps.log, 'list');
  const { ticker, page, pageSize } = input;
  const company = await deps.companies.findByTicker(ticker);
  if (company === undefined) {
    log.debug({ step: 'resolve', ticker }, 'no company trades under the ticker');
    throw new NotFoundError('company', ticker);
  }
  const slice = await deps.filings.page({
    cik: company.cik,
    form: input.form,
    sort: input.sort,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  log.debug({ step: 'read', ticker, cik: company.cik, page, pageSize, total: slice.total }, 'filings listed');
  return { company, filings: { items: [...slice.items], page, pageSize, total: slice.total } };
}
