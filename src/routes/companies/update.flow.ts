import type { CompanyUpdateInput, CompanyUpdateOutput } from './contract.ts';
import type { Company } from '../../entities/company.ts';
import type { Log } from '../../logging.ts';

import { NotFoundError } from '../../errors.ts';
import { scoped } from '../../logging.ts';

/**
 * What `updateCompany` reads: a store with the one method it calls, and the log its transport
 * has bound to the `Companies` domain. `setSelected` answers the changed company, or `undefined`
 * when no company trades under the ticker. This stage passes the fixed stub store from `stub.ts`.
 */
export interface UpdateCompanyDeps {
  readonly store: { setSelected(ticker: string, selected: boolean): Promise<Company | undefined> }
  readonly log: Log
}

/**
 * Sets whether a company is in the summary. `selected` is set as given, never toggled, so
 * sending the same body twice leaves the company as the first call did.
 *
 * Its scope is `update`. The change is an `info` line with step `write`, since choosing the
 * summary's companies is the use case's critical path; a ticker no company trades under is a
 * `debug` line with the same step, because the caller's miss is not the service's failure.
 *
 * @param input - The parsed `company_update` input, its ticker upper cased.
 * @param deps - The store and the domain-bound log.
 * @returns The company after the change.
 * @throws {NotFoundError} When no company trades under `input.ticker`.
 */
export async function updateCompany(input: CompanyUpdateInput, deps: UpdateCompanyDeps): Promise<CompanyUpdateOutput> {
  const log = scoped(deps.log, 'update');
  const { ticker, selected } = input;
  const updated = await deps.store.setSelected(ticker, selected);
  if (updated === undefined) {
    log.debug({ step: 'write', ticker }, 'no company trades under the ticker');
    throw new NotFoundError('company', ticker);
  }
  log.info({ step: 'write', ticker, cik: updated.cik, selected }, 'company selection set');
  return updated;
}
