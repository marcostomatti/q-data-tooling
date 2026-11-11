import type { Company } from '../../../src/entities/company.ts';

import { describe, expect, test } from 'bun:test';

import { NotFoundError } from '../../../src/errors.ts';
import { inDomain } from '../../../src/logging.ts';
import { updateCompany } from '../../../src/routes/companies/update.flow.ts';
import { captureLog } from '../../support/capture-log.ts';
import { FIXED_COMPANIES } from '../fixtures.ts';

/** The first fixed company, or a loud failure: an empty fixture would otherwise read as a pass. */
function firstCompany(): Company {
  const company = FIXED_COMPANIES[0];
  if (company === undefined) throw new Error('FIXED_COMPANIES is empty');
  return company;
}

/** A fake store that knows one company by its ticker and keeps every call it was asked. */
function fakeStore(known: Company): { store: { setSelected(ticker: string, selected: boolean): Promise<Company | undefined> }; asked: [string, boolean][] } {
  const asked: [string, boolean][] = [];
  return {
    asked,
    store: {
      async setSelected(ticker, selected) {
        asked.push([ticker, selected]);
        return ticker === known.ticker
          ? { ...known, selected }
          : undefined;
      },
    },
  };
}

describe('updateCompany flow, called with no transport', () => {
  test('sets the flag as given and answers the changed company', async () => {
    const company = firstCompany();
    const { store, asked } = fakeStore(company);

    const updated = await updateCompany({ ticker: company.ticker, selected: !company.selected }, { store, log: captureLog().log });

    expect(asked).toEqual([[company.ticker, !company.selected]]);
    expect(updated).toEqual({ ...company, selected: !company.selected });
  });

  test('throws a NotFoundError naming the ticker no company trades under', async () => {
    const { store } = fakeStore(firstCompany());

    const outcome = updateCompany({ ticker: 'NOPE', selected: true }, { store, log: captureLog().log });

    expect(outcome).rejects.toBeInstanceOf(NotFoundError);
    expect(outcome).rejects.toThrow('company NOPE does not exist');
  });

  test('writes the change at info with step write under scope update and the bound domain', async () => {
    const company = firstCompany();
    const captured = captureLog();

    await updateCompany({ ticker: company.ticker, selected: true }, { store: fakeStore(company).store, log: inDomain(captured.log, 'Companies') });

    expect(captured.records).toEqual([
      { domain: 'Companies', scope: 'update', step: 'write', ticker: company.ticker, cik: company.cik, selected: true, level: 'info', msg: 'company selection set' },
    ]);
  });

  test('writes a miss at debug with step write, not as a failure of the service', async () => {
    const captured = captureLog();

    await updateCompany({ ticker: 'NOPE', selected: true }, { store: fakeStore(firstCompany()).store, log: inDomain(captured.log, 'Companies') }).catch(() => undefined);

    expect(captured.records).toEqual([
      { domain: 'Companies', scope: 'update', step: 'write', ticker: 'NOPE', level: 'debug', msg: 'no company trades under the ticker' },
    ]);
  });
});
