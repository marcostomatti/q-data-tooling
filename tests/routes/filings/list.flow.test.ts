import type { Company } from '../../../src/entities/company.ts';
import type { FilingPageQuery, FilingSlice, ListFilingsDeps } from '../../../src/routes/filings/list.flow.ts';

import { describe, expect, test } from 'bun:test';

import { NotFoundError } from '../../../src/errors.ts';
import { inDomain } from '../../../src/logging.ts';
import { listFilings } from '../../../src/routes/filings/list.flow.ts';
import { SecForbiddenError, submissionsUrl } from '../../../src/sec/client.ts';
import { captureLog } from '../../support/capture-log.ts';
import { FIXED_COMPANIES, FIXED_FILINGS } from '../fixtures.ts';

import { callNames, fakeSyncSources, hoursBeforeNow, NOW } from './fake-sync.ts';

/** The first fixed company, or a loud failure: an empty fixture would otherwise read as a pass. */
function firstCompany(): Company {
  const company = FIXED_COMPANIES[0];
  if (company === undefined) throw new Error('FIXED_COMPANIES is empty');
  return company;
}

/** Fake stores: one company known by its ticker, a fixed slice of filings, and every page query asked. */
function fakeStores(known: Company, slice: FilingSlice): Omit<ListFilingsDeps, 'log' | 'sync'> & { asked: FilingPageQuery[] } {
  const asked: FilingPageQuery[] = [];
  return {
    asked,
    companies: {
      async findByTicker(ticker) {
        return ticker === known.ticker
          ? known
          : undefined;
      },
    },
    filings: {
      async page(query) {
        asked.push(query);
        return slice;
      },
    },
  };
}

describe('listFilings flow, called with no transport', () => {
  test('resolves the ticker, then reads the window of the company\'s filings with the filter and order passed through', async () => {
    const company = firstCompany();
    const { asked, ...stores } = fakeStores(company, { items: [], total: 0 });

    await listFilings({ ticker: company.ticker, page: 3, pageSize: 10, form: '10-K', sort: 'filingDate' }, { ...stores, log: captureLog().log });

    expect(asked).toEqual([{ cik: company.cik, form: '10-K', sort: 'filingDate', offset: 20, limit: 10 }]);
  });

  test('answers the company and the store\'s rows with the page asked for and the total of every match', async () => {
    const company = firstCompany();
    const { asked: _asked, ...stores } = fakeStores(company, { items: FIXED_FILINGS, total: 42 });

    const outcome = await listFilings({ ticker: company.ticker, page: 1, pageSize: 25, sort: '-filingDate' }, { ...stores, log: captureLog().log });

    expect(outcome).toEqual({ company, filings: { items: [...FIXED_FILINGS], page: 1, pageSize: 25, total: 42 } });
  });

  test('throws a NotFoundError naming the ticker no company trades under, and reads no filings', async () => {
    const { asked, ...stores } = fakeStores(firstCompany(), { items: [], total: 0 });

    const outcome = listFilings({ ticker: 'NOPE', page: 1, pageSize: 25, sort: '-filingDate' }, { ...stores, log: captureLog().log });

    expect(outcome).rejects.toBeInstanceOf(NotFoundError);
    expect(outcome).rejects.toThrow('company NOPE does not exist');
    await outcome.catch(() => undefined);
    expect(asked).toEqual([]);
  });

  test('scopes its one line at list and writes it at debug with step read, carrying the domain bound above', async () => {
    const company = firstCompany();
    const captured = captureLog();
    const { asked: _asked, ...stores } = fakeStores(company, { items: [], total: 0 });

    await listFilings({ ticker: company.ticker, page: 2, pageSize: 5, sort: '-filingDate' }, { ...stores, log: inDomain(captured.log, 'Filings') });

    expect(captured.records).toEqual([
      { domain: 'Filings', scope: 'list', step: 'read', ticker: company.ticker, cik: company.cik, page: 2, pageSize: 5, total: 0, level: 'debug', msg: 'filings listed' },
    ]);
  });

  test('writes a miss at debug with step resolve, not as a failure of the service', async () => {
    const captured = captureLog();
    const { asked: _asked, ...stores } = fakeStores(firstCompany(), { items: [], total: 0 });

    await listFilings({ ticker: 'NOPE', page: 1, pageSize: 25, sort: '-filingDate' }, { ...stores, log: inDomain(captured.log, 'Filings') }).catch(() => undefined);

    expect(captured.records).toEqual([
      { domain: 'Filings', scope: 'list', step: 'resolve', ticker: 'NOPE', level: 'debug', msg: 'no company trades under the ticker' },
    ]);
  });
});

describe('listFilings flow, with the sync sources given', () => {
  const input = { ticker: 'AAPL', page: 1, pageSize: 25, sort: '-filingDate' } as const;

  test('syncs a company never synced before reading its page, and answers the company as the sync wrote it', async () => {
    const company = firstCompany();
    const { asked, ...stores } = fakeStores(company, { items: [], total: 0 });
    const { sources, calls } = fakeSyncSources({ company });

    const outcome = await listFilings(input, { ...stores, sync: sources, log: captureLog().log });

    expect(callNames(calls)).toEqual(['getSubmissions', 'insert', 'deleteBefore', 'updateHeader']);
    expect(asked).toHaveLength(1);
    expect(outcome.company).toEqual({ ...company, exchanges: ['Nasdaq'], sicDescription: 'Electronic Computers', category: 'Large accelerated filer', fiscalYearEnd: '0926', filingsSyncedAt: NOW.toISOString() });
  });

  test('makes no SEC call for a company synced within the TTL', async () => {
    const company = { ...firstCompany(), filingsSyncedAt: hoursBeforeNow(2) };
    const { asked: _asked, ...stores } = fakeStores(company, { items: FIXED_FILINGS, total: FIXED_FILINGS.length });
    const { sources, calls } = fakeSyncSources({ company });

    const outcome = await listFilings(input, { ...stores, sync: sources, log: captureLog().log });

    expect(calls).toEqual([]);
    expect(outcome.company).toBe(company);
  });

  test('throws the SEC failure for a company never synced, and reads no page', async () => {
    const company = firstCompany();
    const { asked, ...stores } = fakeStores(company, { items: [], total: 0 });
    const { sources } = fakeSyncSources({ company, secFailure: new SecForbiddenError(submissionsUrl(company.cik10)) });

    const outcome = listFilings(input, { ...stores, sync: sources, log: captureLog().log });

    expect(outcome).rejects.toBeInstanceOf(SecForbiddenError);
    await outcome.catch(() => undefined);
    expect(asked).toEqual([]);
  });

  test('serves the stored page with the stale filingsSyncedAt when SEC fails for a company synced before', async () => {
    const company = { ...firstCompany(), filingsSyncedAt: hoursBeforeNow(72) };
    const { asked: _asked, ...stores } = fakeStores(company, { items: FIXED_FILINGS, total: FIXED_FILINGS.length });
    const { sources } = fakeSyncSources({ company, secFailure: new SecForbiddenError(submissionsUrl(company.cik10)) });

    const outcome = await listFilings(input, { ...stores, sync: sources, log: captureLog().log });

    expect(outcome).toEqual({ company, filings: { items: [...FIXED_FILINGS], page: 1, pageSize: 25, total: FIXED_FILINGS.length } });
  });

  test('makes no SEC call for a ticker no company trades under', async () => {
    const { asked: _asked, ...stores } = fakeStores(firstCompany(), { items: [], total: 0 });
    const { sources, calls } = fakeSyncSources({ company: firstCompany() });

    await listFilings({ ...input, ticker: 'NOPE' }, { ...stores, sync: sources, log: captureLog().log }).catch(() => undefined);

    expect(calls).toEqual([]);
  });
});
