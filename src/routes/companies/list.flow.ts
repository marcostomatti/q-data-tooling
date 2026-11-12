import type { CompanyListInput, CompanyListOutput } from './contract.ts';
import type { Company } from '../../entities/company.ts';
import type { Log } from '../../logging.ts';

import { scoped } from '../../logging.ts';

/**
 * What `listCompanies` asks its store for: the filters of the input and the window of rows the
 * page covers, `offset` rows in and at most `limit` long.
 */
export interface CompanyListQuery {
  /** The ticker prefix, name part or CIK to match, or `undefined` to match every company. */
  readonly q: string | undefined
  /** Keep only the companies in or out of the summary, or `undefined` to keep both. */
  readonly selected: boolean | undefined
  /** The count of matching rows to skip. */
  readonly offset: number
  /** The most rows to return. */
  readonly limit: number
}

/** What the store answers for a {@link CompanyListQuery}: the rows in its window and the count of every match. */
export interface CompanyListSlice {
  /** The rows in the window. */
  readonly items: readonly Company[]
  /** The count of every matching row. */
  readonly total: number
}

/**
 * What `listCompanies` reads: a store with the one method it calls, and the log its transport
 * has bound to the `Companies` domain. The route and the tool pass `companyStore(db)` from
 * `repository.ts`.
 */
export interface ListCompaniesDeps {
  /** The companies store. */
  readonly store: {
    /** Reads the window of companies the query names. */
    list(query: CompanyListQuery): Promise<CompanyListSlice>
  }
  /** The log bound to the `Companies` domain. */
  readonly log: Log
}

/**
 * Lists one page of companies, filtered by `q` and `selected`. The paging is the server's: the
 * flow turns `page` and `pageSize` into the window the store reads.
 *
 * Its scope is `list`, and its one crumb is a `debug` line with step `read`: a read is routine.
 *
 * @param input - The parsed `company_list` input.
 * @param deps - The store and the domain-bound log.
 * @returns The page, with the `page` and `pageSize` asked for and the total of every match.
 */
export async function listCompanies(input: CompanyListInput, deps: ListCompaniesDeps): Promise<CompanyListOutput> {
  const log = scoped(deps.log, 'list');
  const { page, pageSize } = input;
  const slice = await deps.store.list({
    q: input.q,
    selected: input.selected,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  log.debug({ step: 'read', page, pageSize, total: slice.total }, 'companies listed');
  return { items: [...slice.items], page, pageSize, total: slice.total };
}
