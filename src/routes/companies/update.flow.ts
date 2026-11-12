import type { CompanyUpdateInput, CompanyUpdateOutput } from './contract.ts';
import type { Company } from '../../entities/company.ts';
import type { Log } from '../../logging.ts';
import type { FilingSyncSources } from '../filings/sync.flow.ts';

import { NotFoundError } from '../../errors.ts';
import { scoped } from '../../logging.ts';
import { syncIfStale } from '../filings/sync.flow.ts';

/**
 * What `updateCompany` reads: a store that resolves a ticker and sets the flag, the sources a
 * sync reads and writes through, and the log its transport has bound to the `Companies` domain.
 * `findByTicker` and `setSelected` answer the company, or `undefined` when no company trades
 * under the ticker. The route and the tool pass `companyStore(db)` from `repository.ts`. Without
 * `sync` the flow sets the flag only and never calls SEC.
 */
export interface UpdateCompanyDeps {
  /** The companies store. */
  readonly store: {
    /** Answers the company trading under the ticker, or `undefined` when none does. */
    findByTicker(ticker: string): Promise<Company | undefined>
    /** Sets the company's `selected` flag and answers it, or `undefined` for an unknown ticker. */
    setSelected(ticker: string, selected: boolean): Promise<Company | undefined>
  }
  /** The SEC client, stores and clock the sync before `selected: true` runs on; without them no sync runs. */
  readonly sync?: FilingSyncSources
  /** The log bound to the `Companies` domain. */
  readonly log: Log
}

/** The `debug` line and the `NotFoundError` of a ticker no company trades under. */
function miss(log: Log, ticker: string): NotFoundError {
  log.debug({ step: 'write', ticker }, 'no company trades under the ticker');
  return new NotFoundError('company', ticker);
}

/**
 * Sets whether a company is in the summary. `selected` is set as given, never toggled, so
 * sending the same body twice leaves the company as the first call did.
 *
 * With `deps.sync` given, `selected: true` syncs a stale company's filings through
 * `syncIfStale` before the flag is set, so every company in the summary has data. When that sync
 * fails for a company synced before, its stored rows stand and the flag is set; for a company
 * never synced the SEC failure is thrown and the flag is left as it was. `selected: false` never
 * syncs.
 *
 * Its scope is `update`. The change is an `info` line with step `write`, since choosing the
 * summary's companies is the use case's critical path; a ticker no company trades under is a
 * `debug` line with the same step, because the caller's miss is not the service's failure. The
 * sync writes its own lines, under scope `sync`.
 *
 * @param input - The parsed `company_update` input, its ticker upper cased.
 * @param deps - The store, the optional sync sources and the domain-bound log.
 * @returns The company after the change, with the header fields of the sync when one ran.
 * @throws {NotFoundError} When no company trades under `input.ticker`.
 * @throws {SecRequestError} When `selected` is `true`, the company was never synced and its sync fails at SEC.
 */
export async function updateCompany(input: CompanyUpdateInput, deps: UpdateCompanyDeps): Promise<CompanyUpdateOutput> {
  const log = scoped(deps.log, 'update');
  const { ticker, selected } = input;
  if (selected && deps.sync !== undefined) {
    const company = await deps.store.findByTicker(ticker);
    if (company === undefined) throw miss(log, ticker);
    await syncIfStale(company, { ...deps.sync, log: deps.log });
  }
  const updated = await deps.store.setSelected(ticker, selected);
  if (updated === undefined) throw miss(log, ticker);
  log.info({ step: 'write', ticker, cik: updated.cik, selected }, 'company selection set');
  return updated;
}
