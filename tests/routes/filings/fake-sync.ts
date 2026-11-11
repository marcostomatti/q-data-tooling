/**
 * The fakes the sync tests hand to `syncFilings`, `syncIfStale` and the two flows that call it:
 * a submissions document in Apple's shape, and sync sources whose SEC client answers it (or
 * throws what the test names) and whose stores record every call, in order, with no database.
 * The header fields are Apple's public SEC facts; the filings are hand-written in its shape.
 *
 * @module
 */

import type { Company } from '../../../src/entities/company.ts';
import type { Filing } from '../../../src/entities/filing.ts';
import type { FilingSyncSources, SyncedHeader } from '../../../src/routes/filings/sync.flow.ts';
import type { FilingColumns, RawRow } from '../../../src/sec/parse.ts';

/** The time every sync test runs at: its retention cutoff is `2025-11-11`. */
export const NOW = new Date('2026-11-11T12:00:00.000Z');

/** The cutoff `retentionCutoff(NOW)` gives: the first filing date a sync keeps. */
export const CUTOFF = '2025-11-11';

const MS_PER_HOUR = 3_600_000;

/**
 * `NOW` less `hours`, as the ISO datetime `filingsSyncedAt` holds.
 *
 * @param hours - How long before `NOW`.
 * @returns The ISO datetime.
 */
export const hoursBeforeNow = (hours: number): string => new Date(NOW.getTime() - hours * MS_PER_HOUR).toISOString();

/** A row of `filings.recent` with the given fields over a plain 8-K's. */
function row(fields: Partial<RawRow>): RawRow {
  return {
    accessionNumber: '0000320193-26-000001',
    filingDate: '2026-06-01',
    reportDate: '2026-06-01',
    acceptanceDateTime: '2026-06-01T20:30:00.000Z',
    act: '34',
    form: '8-K',
    fileNumber: '001-36743',
    filmNumber: '261000001',
    items: '9.01',
    core_type: 'XBRL',
    size: 100000,
    isXBRL: 1,
    isInlineXBRL: 1,
    isXBRLNumeric: 0,
    primaryDocument: 'aapl-20260601.htm',
    primaryDocDescription: '8-K',
    ...fields,
  };
}

/**
 * Six rows: a 10-K, a 10-K/A and an 8-K of the last year, an 8-K filed on the cutoff, a Form 4
 * of the last year, and a 10-Q filed the day before the cutoff. A sync keeps the first four.
 */
export const ROWS: readonly RawRow[] = [
  row({ accessionNumber: '0000320193-26-000026', filingDate: '2026-11-03', form: '10-K', items: '', primaryDocument: 'aapl-20260926.htm', primaryDocDescription: '10-K' }),
  row({ accessionNumber: '0000320193-26-000030', filingDate: '2026-11-06', form: '10-K/A', items: '', primaryDocument: 'aapl-20260926a.htm', primaryDocDescription: '10-K/A' }),
  row({ accessionNumber: '0000320193-26-000024', filingDate: '2026-10-30', form: '8-K', items: '2.02,9.01' }),
  row({ accessionNumber: '0000320193-25-000101', filingDate: CUTOFF, form: '8-K' }),
  row({ accessionNumber: '0001140361-26-040001', filingDate: '2026-10-17', form: '4', act: '', isXBRL: 0, isInlineXBRL: 0, primaryDocument: 'xslF345X06/form4.xml' }),
  row({ accessionNumber: '0000320193-25-000100', filingDate: '2025-11-10', form: '10-Q' }),
];

/** The accession numbers a sync of {@link ROWS} at `NOW` stores, in EDGAR's order. */
export const KEPT_ACCESSIONS: readonly string[] = ROWS.slice(0, 4).map((r) => r.accessionNumber);

/**
 * Turns rows into EDGAR's column arrays, the shape `filings.recent` holds.
 *
 * @param rows - The rows to turn.
 * @returns One array per field.
 */
export function toColumns(rows: readonly RawRow[]): FilingColumns {
  const keys = Object.keys(row({})) as (keyof FilingColumns)[];
  return Object.fromEntries(keys.map((k) => [k, rows.map((r) => r[k])])) as FilingColumns;
}

const ADDRESS = {
  street1: 'ONE EXAMPLE WAY',
  street2: null,
  city: 'EXAMPLE CITY',
  stateOrCountry: 'CA',
  zipCode: '00000',
  stateOrCountryDescription: 'CA',
  isForeignLocation: 0,
  foreignStateTerritory: null,
  country: null,
  countryCode: null,
};

/**
 * A submissions document of Apple holding `recent`, with placeholder contact fields and an
 * empty `sic` so the sync's empty-to-`null` is seen.
 *
 * @param recent - The filing columns, {@link ROWS} by default.
 * @returns The document as SEC's JSON would parse.
 */
export function submissionsDocument(recent: FilingColumns = toColumns(ROWS)): Record<string, unknown> {
  return {
    cik: '0000320193',
    entityType: 'operating',
    sic: '',
    sicDescription: 'Electronic Computers',
    ownerOrg: '06 Technology',
    insiderTransactionForOwnerExists: 0,
    insiderTransactionForIssuerExists: 1,
    name: 'Apple Inc.',
    tickers: ['AAPL'],
    exchanges: ['Nasdaq'],
    ein: '942404110',
    lei: null,
    description: '',
    website: '',
    investorWebsite: '',
    category: 'Large accelerated filer',
    fiscalYearEnd: '0926',
    stateOfIncorporation: 'CA',
    stateOfIncorporationDescription: 'CA',
    addresses: { mailing: ADDRESS, business: ADDRESS },
    phone: '000-000-0000',
    flags: '',
    formerNames: [],
    filings: { recent, files: [] },
  };
}

/** One call a fake source was asked, in the order it was asked. */
export type SyncCall =
  | { readonly call: 'getSubmissions', readonly cik10: string }
  | { readonly call: 'insert', readonly rows: readonly Filing[] }
  | { readonly call: 'deleteBefore', readonly cik: number, readonly cutoff: string }
  | { readonly call: 'updateHeader', readonly cik: number, readonly header: SyncedHeader };

/** What {@link fakeSyncSources} is built from. */
export interface FakeSyncOptions {
  /** The company `updateHeader` writes onto; `undefined` makes it answer an unknown CIK. */
  readonly company: Company | undefined
  /** What `getSubmissions` answers, {@link submissionsDocument} by default. */
  readonly document?: unknown
  /** What `getSubmissions` throws instead of answering. */
  readonly secFailure?: Error
  /** What `insert` throws instead of answering. */
  readonly insertFailure?: Error
}

/** Fake sync sources and every call they were asked. */
export interface FakeSync {
  readonly sources: FilingSyncSources
  readonly calls: readonly SyncCall[]
}

/**
 * Sync sources over no database. `insert` answers the count of rows, `deleteBefore` answers 0,
 * and `updateHeader` answers the company with the header written onto it.
 *
 * @param options - The company, and what SEC answers or throws.
 * @returns The sources and their recorded calls.
 */
export function fakeSyncSources(options: FakeSyncOptions): FakeSync {
  const calls: SyncCall[] = [];
  const sources: FilingSyncSources = {
    sec: {
      async getSubmissions(cik10) {
        calls.push({ call: 'getSubmissions', cik10 });
        if (options.secFailure !== undefined) throw options.secFailure;
        return options.document ?? submissionsDocument();
      },
    },
    filings: {
      async insert(rows) {
        calls.push({ call: 'insert', rows });
        if (options.insertFailure !== undefined) throw options.insertFailure;
        return rows.length;
      },
      async deleteBefore(cik, cutoff) {
        calls.push({ call: 'deleteBefore', cik, cutoff });
        return 0;
      },
    },
    companies: {
      async updateHeader(cik, header) {
        calls.push({ call: 'updateHeader', cik, header });
        if (options.company === undefined) return undefined;
        const { syncedAt, exchanges, ...fields } = header;
        return { ...options.company, ...fields, exchanges: [...exchanges], filingsSyncedAt: syncedAt.toISOString() };
      },
    },
    now: () => NOW,
  };
  return { sources, calls };
}

/**
 * The names of the calls, in order: the shape most order assertions need.
 *
 * @param calls - The recorded calls.
 * @returns Each call's name.
 */
export const callNames = (calls: readonly SyncCall[]): string[] => calls.map((c) => c.call);
