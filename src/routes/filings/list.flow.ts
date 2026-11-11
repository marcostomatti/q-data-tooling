import type { FilingListInput, FilingListOutput, FilingSort } from './contract.ts';
import type { FilingSyncSources } from './sync.flow.ts';
import type { Company } from '../../entities/company.ts';
import type { Filing, TrackedForm } from '../../entities/filing.ts';
import type { Log } from '../../logging.ts';

import { NotFoundError } from '../../errors.ts';
import { scoped } from '../../logging.ts';

import { syncIfStale } from './sync.flow.ts';

/**
 * What `listFilings` asks its filings store for: the company's CIK, the base form to keep when
 * one is named, the order, and the window of rows the page covers, `offset` rows in and at most
 * `limit` long.
 */
export interface FilingPageQuery {
  /** The CIK of the company whose filings to read. */
  readonly cik: number
  /** The base form to keep, or `undefined` to keep every tracked form. */
  readonly form: TrackedForm | undefined
  /** The order of the rows. */
  readonly sort: FilingSort
  /** The count of matching rows to skip. */
  readonly offset: number
  /** The most rows to return. */
  readonly limit: number
}

/** What the filings store answers for a {@link FilingPageQuery}: the rows in its window and the count of every match. */
export interface FilingSlice {
  /** The rows in the window. */
  readonly items: readonly Filing[]
  /** The count of every matching row. */
  readonly total: number
}

/**
 * What `listFilings` reads: a companies store that resolves a ticker to its company, or
 * `undefined` when no company trades under it, a filings store that pages one company's filings,
 * the sources a sync reads and writes through, and the log its transport has bound to the
 * `Filings` domain. The route and the tool pass the stores `repository.ts` builds over their
 * `db`. Without `sync` the flow reads the stored rows only and never calls SEC.
 */
export interface ListFilingsDeps {
  /** The companies store. */
  readonly companies: {
    /** Answers the company trading under the ticker, or `undefined` when none does. */
    findByTicker(ticker: string): Promise<Company | undefined>
  }
  /** The filings store. */
  readonly filings: {
    /** Reads the window of one company's filings the query names. */
    page(query: FilingPageQuery): Promise<FilingSlice>
  }
  /** The SEC client, stores and clock a sync of a stale company runs on; without them no sync runs. */
  readonly sync?: FilingSyncSources
  /** The log bound to the `Filings` domain. */
  readonly log: Log
}

/**
 * Lists one page of the filings of the company with the ticker, with the company itself. The
 * paging is the server's: the flow turns `page` and `pageSize` into the window the store reads.
 * When `deps.sync` is given and the company is stale, its filings are synced from SEC first,
 * through `syncIfStale`; when that sync fails for a company synced before, its stored rows are
 * listed, the company's `filingsSyncedAt` showing their age.
 *
 * Its scope is `list`. The page is a `debug` line with step `read`, since a read is routine; a
 * ticker no company trades under is a `debug` line with step `resolve`, because the caller's
 * miss is not the service's failure. The sync writes its own lines, under scope `sync`.
 *
 * @param input - The parsed `filing_list` input, its ticker upper cased.
 * @param deps - The companies and filings stores, the optional sync sources and the domain-bound log.
 * @returns The company and the page, with the `page` and `pageSize` asked for and the total of every match.
 * @throws {NotFoundError} When no company trades under `input.ticker`.
 * @throws {SecRequestError} When the company was never synced and its sync fails at SEC.
 */
export async function listFilings(input: FilingListInput, deps: ListFilingsDeps): Promise<FilingListOutput> {
  const log = scoped(deps.log, 'list');
  const { ticker, page, pageSize } = input;
  const found = await deps.companies.findByTicker(ticker);
  if (found === undefined) {
    log.debug({ step: 'resolve', ticker }, 'no company trades under the ticker');
    throw new NotFoundError('company', ticker);
  }
  const company = deps.sync === undefined
    ? found
    : await syncIfStale(found, { ...deps.sync, log: deps.log });
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
