import type { Company } from '../../../src/entities/company.ts';
import type { UpdateCompanyDeps } from '../../../src/routes/companies/update.flow.ts';
import type { SyncCall } from '../filings/fake-sync.ts';

import { describe, expect, test } from 'bun:test';

import { NotFoundError } from '../../../src/errors.ts';
import { inDomain } from '../../../src/logging.ts';
import { updateCompany } from '../../../src/routes/companies/update.flow.ts';
import { SecForbiddenError, submissionsUrl } from '../../../src/sec/client.ts';
import { captureLog } from '../../support/capture-log.ts';
import { callNames, fakeSyncSources, hoursBeforeNow, NOW } from '../filings/fake-sync.ts';
import { FIXED_COMPANIES } from '../fixtures.ts';

/** The first fixed company, or a loud failure: an empty fixture would otherwise read as a pass. */
function firstCompany(): Company {
  const company = FIXED_COMPANIES[0];
  if (company === undefined) throw new Error('FIXED_COMPANIES is empty');
  return company;
}

/**
 * A fake store that knows one company by its ticker and keeps every call it was asked, in
 * `order` beside the sync's when one is passed. `setSelected` answers `stored()`, the company as
 * the sync left it, with the flag set.
 */
function fakeStore(known: Company, stored: () => Company = () => known, order: string[] = []): { store: UpdateCompanyDeps['store'], asked: [string, boolean][], order: string[] } {
  const asked: [string, boolean][] = [];
  return {
    asked,
    order,
    store: {
      async findByTicker(ticker) {
        order.push('findByTicker');
        return ticker === known.ticker
          ? known
          : undefined;
      },
      async setSelected(ticker, selected) {
        order.push('setSelected');
        asked.push([ticker, selected]);
        return ticker === known.ticker
          ? { ...stored(), selected }
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

/** The company the fake sync wrote, read off its `updateHeader` call, or the company as stored when none ran. */
function writtenBy(calls: readonly SyncCall[], company: Company): Company {
  const write = calls.find((c) => c.call === 'updateHeader');
  if (write?.call !== 'updateHeader') return company;
  const { syncedAt, exchanges, ...fields } = write.header;
  return { ...company, ...fields, exchanges: [...exchanges], filingsSyncedAt: syncedAt.toISOString() };
}

describe('updateCompany flow, with the sync sources given', () => {
  test('selected: true syncs a company never synced before setting the flag, and answers the synced company selected', async () => {
    const company = { ...firstCompany(), selected: false };
    const { sources, calls } = fakeSyncSources({ company });
    const { store: base } = fakeStore(company, () => writtenBy(calls, company));
    const syncSeenBy: [string, string[]][] = [];
    const store: UpdateCompanyDeps['store'] = {
      async findByTicker(ticker) {
        syncSeenBy.push(['findByTicker', callNames(calls)]);
        return base.findByTicker(ticker);
      },
      async setSelected(ticker, selected) {
        syncSeenBy.push(['setSelected', callNames(calls)]);
        return base.setSelected(ticker, selected);
      },
    };

    const updated = await updateCompany({ ticker: company.ticker, selected: true }, { store, sync: sources, log: captureLog().log });

    expect(syncSeenBy).toEqual([
      ['findByTicker', []],
      ['setSelected', ['getSubmissions', 'insert', 'deleteBefore', 'updateHeader']],
    ]);
    expect(updated).toMatchObject({ selected: true, exchanges: ['Nasdaq'], filingsSyncedAt: NOW.toISOString() });
  });

  test('selected: true makes no SEC call for a company synced within the TTL', async () => {
    const company = { ...firstCompany(), filingsSyncedAt: hoursBeforeNow(3) };
    const { sources, calls } = fakeSyncSources({ company });

    const updated = await updateCompany({ ticker: company.ticker, selected: true }, { store: fakeStore(company).store, sync: sources, log: captureLog().log });

    expect(calls).toEqual([]);
    expect(updated).toEqual({ ...company, selected: true });
  });

  test('selected: false never syncs, nor resolves the ticker first', async () => {
    const company = firstCompany();
    const { sources, calls } = fakeSyncSources({ company });
    const { store, order } = fakeStore(company);

    await updateCompany({ ticker: company.ticker, selected: false }, { store, sync: sources, log: captureLog().log });

    expect(calls).toEqual([]);
    expect(order).toEqual(['setSelected']);
  });

  test('an SEC failure for a company never synced is thrown and leaves the flag unset', async () => {
    const company = { ...firstCompany(), selected: false };
    const { sources } = fakeSyncSources({ company, secFailure: new SecForbiddenError(submissionsUrl(company.cik10)) });
    const { store, asked } = fakeStore(company);

    const outcome = updateCompany({ ticker: company.ticker, selected: true }, { store, sync: sources, log: captureLog().log });

    expect(outcome).rejects.toBeInstanceOf(SecForbiddenError);
    await outcome.catch(() => undefined);
    expect(asked).toEqual([]);
  });

  test('an SEC failure for a company synced before sets the flag over the stored rows', async () => {
    const company = { ...firstCompany(), selected: false, filingsSyncedAt: hoursBeforeNow(72) };
    const { sources } = fakeSyncSources({ company, secFailure: new SecForbiddenError(submissionsUrl(company.cik10)) });

    const updated = await updateCompany({ ticker: company.ticker, selected: true }, { store: fakeStore(company).store, sync: sources, log: captureLog().log });

    expect(updated).toEqual({ ...company, selected: true });
  });

  test('a ticker no company trades under is a NotFoundError with no SEC call, written at debug with step write', async () => {
    const captured = captureLog();
    const { sources, calls } = fakeSyncSources({ company: firstCompany() });
    const { store, asked } = fakeStore(firstCompany());

    const outcome = updateCompany({ ticker: 'NOPE', selected: true }, { store, sync: sources, log: inDomain(captured.log, 'Companies') });

    expect(outcome).rejects.toThrow('company NOPE does not exist');
    await outcome.catch(() => undefined);
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
    expect(captured.records).toEqual([
      { domain: 'Companies', scope: 'update', step: 'write', ticker: 'NOPE', level: 'debug', msg: 'no company trades under the ticker' },
    ]);
  });
});
