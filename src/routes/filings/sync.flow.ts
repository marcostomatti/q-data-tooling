/**
 * The sync of one company's filings from SEC, per "Ingest flow (one company)" in
 * `setup-prompt.md`. A company is stale when it was never synced or was last synced more than
 * `SYNC_TTL_HOURS` ago; a sync fetches its submissions document, keeps the filings of the last
 * `RETENTION_DAYS`, every form, stores the new ones, deletes the company's
 * stored filings older than the cutoff, and writes the header fields with `filingsSyncedAt`.
 *
 * The filings list flow and the companies update flow call `syncIfStale`, never `syncFilings`
 * directly: it skips a fresh company, and when SEC fails it serves a company synced before with
 * its stored rows, leaving `filingsSyncedAt` to show their age. Only a company with no sync
 * behind it lets the SEC failure through, which the transports answer with 502.
 *
 * @module
 */

import type { Company } from '../../entities/company.ts';
import type { Filing } from '../../entities/filing.ts';
import type { Log } from '../../logging.ts';

import { NotFoundError } from '../../errors.ts';
import { scoped } from '../../logging.ts';
import { SecRequestError, submissionsUrl } from '../../sec/client.ts';
import { columnsToRows, retentionCutoff, SubmissionsHeader, toFiling, withinRetention } from '../../sec/parse.ts';

export { RETENTION_DAYS } from '../../sec/parse.ts';

/** How long a sync stays fresh: a company synced longer ago than this is synced again. */
export const SYNC_TTL_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

/** The status recorded for a submissions document SEC answered but this service cannot read. */
const HTTP_OK = 200;

/**
 * SEC answered the submissions request, but the document is not one this service reads: it
 * breaks `SubmissionsHeader`, its filing columns differ in length, or a filing in the last year
 * breaks `Filing`. It is a `SecRequestError`, so it answers 502 and lets stored rows be served
 * like any other SEC failure. The client resolves only a 2xx and does not hand its status on,
 * so `status` is recorded as 200. `cause` keeps the parse failure, which may quote SEC's data.
 */
export class SecDocumentError extends SecRequestError {
  /**
   * @param url - The public URL that was requested.
   * @param cause - What the parse threw.
   */
  constructor(url: string, cause: unknown) {
    super(HTTP_OK, url, `SEC answered ${url} with a submissions document this service cannot read`, { cause });
    this.name = 'SecDocumentError';
  }
}

/** The header fields a sync writes onto the company, with the time of the sync. */
export interface SyncedHeader {
  /** The exchanges the company trades on. */
  readonly exchanges: readonly string[]
  /** The Standard Industrial Classification code, or `null` when SEC sends none. */
  readonly sic: string | null
  /** The text of the SIC code, or `null` when SEC sends none. */
  readonly sicDescription: string | null
  /** The SEC filer category, or `null` when SEC sends none. */
  readonly category: string | null
  /** The fiscal year end as `MMDD`, or `null` when SEC sends none. */
  readonly fiscalYearEnd: string | null
  /** When the sync ran; it becomes the company's `filingsSyncedAt`. */
  readonly syncedAt: Date
}

/**
 * What a sync reads and writes through, besides the log: the SEC client, a companies store that
 * writes the header, a filings store that inserts and deletes, and the clock. The shapes match
 * `SecClient` from `src/sec/client.ts` and `updateCompanyHeader`, `insertFilings` and
 * `deleteFilingsBefore` from the shared repositories.
 */
export interface FilingSyncSources {
  /** The SEC client. */
  readonly sec: {
    /** Fetches the submissions document of the company with the ten-digit CIK, unchecked. */
    getSubmissions(cik10: string): Promise<unknown>
  }
  /** The companies store. */
  readonly companies: {
    /** Writes the header and `filingsSyncedAt`, answering the company, or `undefined` for an unknown CIK. */
    updateHeader(cik: number, header: SyncedHeader): Promise<Company | undefined>
  }
  /** The filings store. */
  readonly filings: {
    /** Stores the filings whose accession numbers are not stored yet, answering how many it stored. */
    insert(rows: readonly Filing[]): Promise<number>
    /** Deletes the company's filings filed before the `YYYY-MM-DD` cutoff, answering how many it deleted. */
    deleteBefore(cik: number, cutoff: string): Promise<number>
  }
  /** The current time. */
  readonly now: () => Date
}

/** What `syncFilings` and `syncIfStale` read: the {@link FilingSyncSources} and the caller's domain-bound log. */
export interface SyncFilingsDeps extends FilingSyncSources {
  /** The log bound to the caller's domain. */
  readonly log: Log
}

/** What a sync takes out of one submissions document: the header fields and the filings to store. */
interface ReadDocument {
  readonly header: Omit<SyncedHeader, 'syncedAt'>
  readonly filings: readonly Filing[]
}

/** `null` for EDGAR's empty string, the value itself otherwise. */
const emptyToNull = (s: string): string | null => (s === ''
  ? null
  : s);

/**
 * Whether the company's stored filings are due for a sync: it was never synced, its
 * `filingsSyncedAt` is not a time, or that time is more than `SYNC_TTL_HOURS` before `now`.
 * A company synced exactly `SYNC_TTL_HOURS` ago is still fresh.
 *
 * @param company - The company, of which only `filingsSyncedAt` is read.
 * @param now - The current time.
 * @returns `true` when the company should be synced.
 */
export function isStale(company: Pick<Company, 'filingsSyncedAt'>, now: Date): boolean {
  if (company.filingsSyncedAt === null) return true;
  const syncedAt = Date.parse(company.filingsSyncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return now.getTime() - syncedAt > SYNC_TTL_HOURS * MS_PER_HOUR;
}

/** Parses the document and cuts its filings to the last year, every form, before anything is written. */
function readDocument(cik: number, document: unknown, now: Date, url: string): ReadDocument {
  try {
    const parsed = SubmissionsHeader.parse(document);
    const filings = withinRetention(columnsToRows(parsed.filings.recent), now)
      .map((row) => toFiling(cik, row));
    return {
      header: {
        exchanges: parsed.exchanges,
        sic: emptyToNull(parsed.sic),
        sicDescription: emptyToNull(parsed.sicDescription),
        category: emptyToNull(parsed.category),
        fiscalYearEnd: emptyToNull(parsed.fiscalYearEnd),
      },
      filings,
    };
  } catch (error: unknown) {
    throw new SecDocumentError(url, error);
  }
}

/**
 * Syncs one company's filings from SEC, whatever their age. The whole document is parsed and
 * cut before the first write. The writes then run in an order that makes a failure part way
 * safe to retry: the new filings first (an insert keyed on the accession number skips the ones
 * stored before), then the delete of the company's filings older than the cutoff, and the
 * header with `filingsSyncedAt` last, so a company whose sync failed stays stale and the next
 * request syncs it again. Every form of the last year is stored; the summary and the filter
 * count the ones `NamedForm` does not name under `other`.
 *
 * Its scope is `sync`, and its one crumb is an `info` line with step `write` once the header is
 * written: storing a company's filings is the use case's critical path.
 *
 * @param company - The company to sync, as stored.
 * @param deps - The SEC client, the companies and filings stores, the clock and the log.
 * @returns The company with the header fields and `filingsSyncedAt` of this sync.
 * @throws {SecRequestError} When SEC refuses or does not answer, or a subclass of it naming the
 *   status; nothing is written then.
 * @throws {SecDocumentError} When SEC's document cannot be read; nothing is written then.
 * @throws {NotFoundError} When the company is gone by the time its header is written.
 * @throws When a store refuses a write.
 */
export async function syncFilings(company: Company, deps: SyncFilingsDeps): Promise<Company> {
  const log = scoped(deps.log, 'sync');
  const now = deps.now();
  const document = await deps.sec.getSubmissions(company.cik10);
  const { header, filings } = readDocument(company.cik, document, now, submissionsUrl(company.cik10));
  const inserted = await deps.filings.insert(filings);
  const deleted = await deps.filings.deleteBefore(company.cik, retentionCutoff(now));
  const updated = await deps.companies.updateHeader(company.cik, { ...header, syncedAt: now });
  if (updated === undefined) throw new NotFoundError('company', company.cik);
  log.info({ step: 'write', ticker: company.ticker, cik: company.cik, kept: filings.length, inserted, deleted }, 'filings synced');
  return updated;
}

/**
 * Syncs the company when {@link isStale} says it is due, and answers it as it then stands. When
 * SEC fails and the company was synced before, its stored filings are served as they are: the
 * company is answered unchanged, its `filingsSyncedAt` showing their age.
 *
 * Its scope is `sync`. A fresh company is a `debug` line with step `check`; an SEC failure is a
 * `warn` line with step `fetch` and the SEC status, whether the stored rows are served or not.
 *
 * @param company - The company, as stored.
 * @param deps - The SEC client, the companies and filings stores, the clock and the log.
 * @returns The company after the sync, or as stored when it is fresh or SEC failed after an earlier sync.
 * @throws {SecRequestError} When SEC fails, or its document cannot be read, for a company never
 *   synced, which has no stored filings to serve.
 * @throws {NotFoundError} When the company is gone by the time its header is written.
 * @throws When a store refuses a write.
 */
export async function syncIfStale(company: Company, deps: SyncFilingsDeps): Promise<Company> {
  const log = scoped(deps.log, 'sync');
  const fields = { ticker: company.ticker, cik: company.cik, filingsSyncedAt: company.filingsSyncedAt };
  if (!isStale(company, deps.now())) {
    log.debug({ step: 'check', ...fields }, 'filings are fresh');
    return company;
  }
  try {
    return await syncFilings(company, deps);
  } catch (error: unknown) {
    if (!(error instanceof SecRequestError)) throw error;
    if (company.filingsSyncedAt === null) {
      log.warn({ step: 'fetch', ...fields, status: error.status }, 'SEC failed and no filings are stored');
      throw error;
    }
    log.warn({ step: 'fetch', ...fields, status: error.status }, 'SEC failed; serving the stored filings');
    return company;
  }
}
