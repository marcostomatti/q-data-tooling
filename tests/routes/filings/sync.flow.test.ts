import type { Company } from '../../../src/entities/company.ts';

import { describe, expect, test } from 'bun:test';

import { Filing } from '../../../src/entities/filing.ts';
import { describeError, NotFoundError, statusFor } from '../../../src/errors.ts';
import { inDomain } from '../../../src/logging.ts';
import {
  isStale,
  RETENTION_DAYS,
  SecDocumentError,
  SYNC_TTL_HOURS,
  syncFilings,
  syncIfStale,
} from '../../../src/routes/filings/sync.flow.ts';
import { SecForbiddenError, SecNetworkError, SecRequestError, submissionsUrl } from '../../../src/sec/client.ts';
import { retentionCutoff } from '../../../src/sec/parse.ts';
import { captureLog } from '../../support/capture-log.ts';
import { FIXED_COMPANIES } from '../fixtures.ts';

import {
  callNames,
  CUTOFF,
  fakeSyncSources,
  hoursBeforeNow,
  KEPT_ACCESSIONS,
  NOW,
  ROWS,
  submissionsDocument,
  toColumns,
} from './fake-sync.ts';

/** Apple as stored, never synced, or a loud failure: an empty fixture would otherwise read as a pass. */
function apple(fields: Partial<Company> = {}): Company {
  const company = FIXED_COMPANIES.find((c) => c.ticker === 'AAPL');
  if (company === undefined) throw new Error('FIXED_COMPANIES has no AAPL');
  return { ...company, ...fields };
}

const SEC_URL = submissionsUrl('0000320193');

describe('the sync constants', () => {
  test('a sync stays fresh for 24 hours and keeps 365 days of filings', () => {
    expect(SYNC_TTL_HOURS).toBe(24);
    expect(RETENTION_DAYS).toBe(365);
  });

  test('the fixtures\' cutoff is the one the parsers draw at NOW', () => {
    expect(retentionCutoff(NOW)).toBe(CUTOFF);
  });
});

describe('isStale', () => {
  test('a company never synced is stale', () => {
    expect(isStale({ filingsSyncedAt: null }, NOW)).toBe(true);
  });

  test('a company synced within the TTL is fresh, up to exactly SYNC_TTL_HOURS ago', () => {
    expect(isStale({ filingsSyncedAt: hoursBeforeNow(1) }, NOW)).toBe(false);
    expect(isStale({ filingsSyncedAt: hoursBeforeNow(SYNC_TTL_HOURS) }, NOW)).toBe(false);
  });

  test('a company synced a millisecond past the TTL is stale', () => {
    const syncedAt = new Date(NOW.getTime() - SYNC_TTL_HOURS * 3_600_000 - 1).toISOString();

    expect(isStale({ filingsSyncedAt: syncedAt }, NOW)).toBe(true);
  });

  test('a filingsSyncedAt that is not a time is stale, so the next request repairs it', () => {
    expect(isStale({ filingsSyncedAt: 'yesterday' }, NOW)).toBe(true);
  });
});

describe('syncFilings', () => {
  test('fetches the submissions of the company\'s ten-digit CIK', async () => {
    const { sources, calls } = fakeSyncSources({ company: apple() });

    await syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(calls[0]).toEqual({ call: 'getSubmissions', cik10: '0000320193' });
  });

  test('stores every form of the last year, a Form 4, amendments and the cutoff day included', async () => {
    const { sources, calls } = fakeSyncSources({ company: apple() });

    await syncFilings(apple(), { ...sources, log: captureLog().log });

    const insert = calls.find((c) => c.call === 'insert');
    expect(insert?.call).toBe('insert');
    const rows = insert?.call === 'insert'
      ? insert.rows
      : [];
    expect(rows.map((f) => f.accessionNumber)).toEqual([...KEPT_ACCESSIONS]);
    expect(rows.map((f) => [f.form, f.baseForm, f.isAmendment])).toEqual([
      ['10-K', '10-K', false],
      ['10-K/A', '10-K', true],
      ['8-K', '8-K', false],
      ['8-K', '8-K', false],
      ['4', '4', false],
    ]);
    for (const filing of rows) {
      expect(Filing.safeParse(filing).success).toBe(true);
      expect(filing.cik).toBe(320193);
    }
  });

  test('deletes the company\'s filings before the retention cutoff', async () => {
    const { sources, calls } = fakeSyncSources({ company: apple() });

    await syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(calls.filter((c) => c.call === 'deleteBefore')).toEqual([{ call: 'deleteBefore', cik: 320193, cutoff: CUTOFF }]);
  });

  test('writes the header with empty strings as null and the sync time, and answers the company it wrote', async () => {
    const { sources, calls } = fakeSyncSources({ company: apple() });

    const synced = await syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(calls.filter((c) => c.call === 'updateHeader')).toEqual([{
      call: 'updateHeader',
      cik: 320193,
      header: {
        exchanges: ['Nasdaq'],
        sic: null,
        sicDescription: 'Electronic Computers',
        category: 'Large accelerated filer',
        fiscalYearEnd: '0926',
        syncedAt: NOW,
      },
    }]);
    expect(synced).toEqual(apple({
      exchanges: ['Nasdaq'],
      sic: null,
      sicDescription: 'Electronic Computers',
      category: 'Large accelerated filer',
      fiscalYearEnd: '0926',
      filingsSyncedAt: NOW.toISOString(),
    }));
  });

  test('writes the filings first and filingsSyncedAt last, so a sync failing part way stays stale', async () => {
    const { sources, calls } = fakeSyncSources({ company: apple() });

    await syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(callNames(calls)).toEqual(['getSubmissions', 'insert', 'deleteBefore', 'updateHeader']);
  });

  test('a refused insert leaves the header unwritten', async () => {
    const { sources, calls } = fakeSyncSources({ company: apple(), insertFailure: new Error('disk full') });

    const outcome = syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(outcome).rejects.toThrow('disk full');
    await outcome.catch(() => undefined);
    expect(callNames(calls)).toEqual(['getSubmissions', 'insert']);
  });

  test('an SEC refusal is thrown as it is, and nothing is written', async () => {
    const refusal = new SecForbiddenError(SEC_URL);
    const { sources, calls } = fakeSyncSources({ company: apple(), secFailure: refusal });

    const outcome = syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(outcome).rejects.toBe(refusal);
    await outcome.catch(() => undefined);
    expect(callNames(calls)).toEqual(['getSubmissions']);
  });

  test('a document that breaks SubmissionsHeader is a SecDocumentError naming the URL, and nothing is written', async () => {
    const { sources, calls } = fakeSyncSources({ company: apple(), document: { cik: '0000320193' } });

    const outcome = syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(outcome).rejects.toBeInstanceOf(SecDocumentError);
    expect(outcome).rejects.toThrow(`SEC answered ${SEC_URL} with a submissions document this service cannot read`);
    await outcome.catch(() => undefined);
    expect(callNames(calls)).toEqual(['getSubmissions']);
  });

  test('filing columns of different lengths are a SecDocumentError, and nothing is written', async () => {
    const columns = toColumns(ROWS);
    const document = submissionsDocument({ ...columns, form: columns.form.slice(1) });
    const { sources, calls } = fakeSyncSources({ company: apple(), document });

    const failure = await syncFilings(apple(), { ...sources, log: captureLog().log }).then(() => null, (thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(SecDocumentError);
    expect((failure as SecDocumentError).cause).toEqual(new Error('EDGAR columns misaligned: form'));
    expect(callNames(calls)).toEqual(['getSubmissions']);
  });

  test('a SecDocumentError is an SEC failure: 502, with its fixed message shown and no SEC data', () => {
    const error = new SecDocumentError(SEC_URL, new Error('secret detail'));

    expect(error).toBeInstanceOf(SecRequestError);
    expect(statusFor(error)).toBe(502);
    expect(describeError(error)).toEqual({ name: 'SecDocumentError', message: `SEC answered ${SEC_URL} with a submissions document this service cannot read` });
  });

  test('a company gone before its header is written is a NotFoundError naming its CIK', async () => {
    const { sources } = fakeSyncSources({ company: undefined });

    const outcome = syncFilings(apple(), { ...sources, log: captureLog().log });

    expect(outcome).rejects.toBeInstanceOf(NotFoundError);
    expect(outcome).rejects.toThrow('company 320193 does not exist');
  });

  test('scopes its one line at sync and writes it at info with step write and the counts', async () => {
    const captured = captureLog();
    const { sources } = fakeSyncSources({ company: apple() });

    await syncFilings(apple(), { ...sources, log: inDomain(captured.log, 'Filings') });

    expect(captured.records).toEqual([
      { domain: 'Filings', scope: 'sync', step: 'write', ticker: 'AAPL', cik: 320193, kept: 5, inserted: 5, deleted: 0, level: 'info', msg: 'filings synced' },
    ]);
  });
});

describe('syncIfStale', () => {
  test('a company synced within the TTL makes no SEC call and is answered as stored', async () => {
    const company = apple({ filingsSyncedAt: hoursBeforeNow(SYNC_TTL_HOURS - 1) });
    const captured = captureLog();
    const { sources, calls } = fakeSyncSources({ company });

    const answered = await syncIfStale(company, { ...sources, log: inDomain(captured.log, 'Filings') });

    expect(answered).toBe(company);
    expect(calls).toEqual([]);
    expect(captured.records).toEqual([
      { domain: 'Filings', scope: 'sync', step: 'check', ticker: 'AAPL', cik: 320193, filingsSyncedAt: company.filingsSyncedAt, level: 'debug', msg: 'filings are fresh' },
    ]);
  });

  test('a company synced past the TTL is synced and answered as written', async () => {
    const company = apple({ filingsSyncedAt: hoursBeforeNow(SYNC_TTL_HOURS + 1) });
    const { sources, calls } = fakeSyncSources({ company });

    const answered = await syncIfStale(company, { ...sources, log: captureLog().log });

    expect(callNames(calls)).toEqual(['getSubmissions', 'insert', 'deleteBefore', 'updateHeader']);
    expect(answered.filingsSyncedAt).toBe(NOW.toISOString());
  });

  test('an SEC failure for a company never synced is thrown, after a warn line with the status', async () => {
    const refusal = new SecForbiddenError(SEC_URL);
    const captured = captureLog();
    const { sources, calls } = fakeSyncSources({ company: apple(), secFailure: refusal });

    const outcome = syncIfStale(apple(), { ...sources, log: inDomain(captured.log, 'Filings') });

    expect(outcome).rejects.toBe(refusal);
    await outcome.catch(() => undefined);
    expect(callNames(calls)).toEqual(['getSubmissions']);
    expect(captured.records).toEqual([
      { domain: 'Filings', scope: 'sync', step: 'fetch', ticker: 'AAPL', cik: 320193, filingsSyncedAt: null, status: 403, level: 'warn', msg: 'SEC failed and no filings are stored' },
    ]);
  });

  test('an SEC failure for a company synced before answers it as stored, its filingsSyncedAt showing the age', async () => {
    const company = apple({ filingsSyncedAt: hoursBeforeNow(72), exchanges: ['Nasdaq'] });
    const captured = captureLog();
    const { sources, calls } = fakeSyncSources({ company, secFailure: new SecNetworkError(SEC_URL, 'the connection failed') });

    const answered = await syncIfStale(company, { ...sources, log: inDomain(captured.log, 'Filings') });

    expect(answered).toBe(company);
    expect(callNames(calls)).toEqual(['getSubmissions']);
    expect(captured.records).toEqual([
      { domain: 'Filings', scope: 'sync', step: 'fetch', ticker: 'AAPL', cik: 320193, filingsSyncedAt: company.filingsSyncedAt, status: null, level: 'warn', msg: 'SEC failed; serving the stored filings' },
    ]);
  });

  test('an unreadable document for a company synced before also serves the stored rows', async () => {
    const company = apple({ filingsSyncedAt: hoursBeforeNow(48) });
    const { sources } = fakeSyncSources({ company, document: [] });

    const answered = await syncIfStale(company, { ...sources, log: captureLog().log });

    expect(answered).toBe(company);
  });

  test('a store failure is not an SEC failure: it is thrown even when stored rows exist', async () => {
    const company = apple({ filingsSyncedAt: hoursBeforeNow(48) });
    const { sources } = fakeSyncSources({ company, insertFailure: new Error('disk full') });

    const outcome = syncIfStale(company, { ...sources, log: captureLog().log });

    expect(outcome).rejects.toThrow('disk full');
  });
});
