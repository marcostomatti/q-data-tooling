/**
 * The filings repository: the drizzle queries over `filings` that the filings flows and the sync
 * read and write through their injected stores.
 *
 * A filing is answered as the {@link Filing} entity, its five stored link columns gathered into
 * `links`. A filing is keyed by its accession number, so writing the same filing twice keeps the
 * first copy. Forms are matched by their base form, so an amendment such as `10-K/A` counts and
 * filters under `10-K`, and every base form outside `NamedForm` counts and filters under `other`.
 *
 * @module
 */

import type { Db } from './db.ts';
import type { Filing, FilingLinks, FormBucket } from '../../entities/filing.ts';

import { and, asc, count, desc, eq, inArray, lt, max, notInArray, type AnyColumn, type SQL } from 'drizzle-orm';

import { bucketOf, NAMED_FORMS, OTHER_FORMS } from '../../entities/filing.ts';
import { companies, filings, transact } from '../active.ts';

/** The filters, the order and the window of one company's filings. */
export interface FilingPageFilter {
  /** The CIK of the company whose filings to read. */
  readonly cik: number
  /** The bucket to keep, amendments included, or `undefined` to keep every form. */
  readonly form: FormBucket | undefined
  /** By filing date, oldest first (`filingDate`) or newest first (`-filingDate`). */
  readonly sort: 'filingDate' | '-filingDate'
  /** The count of matching filings to skip. */
  readonly offset: number
  /** The most filings to return. */
  readonly limit: number
}

/** One window of a company's filings and the count of every match. */
export interface FilingPage {
  /** The filings in the window, in the order asked for. */
  readonly items: readonly Filing[]
  /** The count of every matching filing, whatever the window. */
  readonly total: number
}

/** The form filter and the window of the summary of the selected companies. */
export interface FilingSummaryFilter {
  /**
   * The bucket to narrow the counts to: the other buckets count 0 and `total` counts this one.
   * `undefined` counts every form. It never drops a company from the summary.
   */
  readonly form: FormBucket | undefined
  /** The count of selected companies to skip. */
  readonly offset: number
  /** The most companies to return. */
  readonly limit: number
}

/**
 * A company's count of stored filings per bucket, amendments included under their base form, so
 * `10-K` counts `10-K` and `10-K/A`, and in `total`, the sum of every bucket.
 */
export type FilingCounts = Readonly<Record<FormBucket | 'total', number>>;

/**
 * The filing date of a company's newest stored filing per bucket, amendments included,
 * `YYYY-MM-DD`, or `null` for a bucket it has none of.
 */
export type LastFiled = Readonly<Record<FormBucket, string | null>>;

/** The filing date and the links of a company's latest stored 10-K. */
export interface Latest10K {
  /** The filing date, `YYYY-MM-DD`. */
  readonly filingDate: string
  /** The filing's SEC links. */
  readonly links: FilingLinks
}

/** One selected company in the summary: who it is, its counts, its latest 10-K and its sync time. */
export interface FilingSummary {
  /** The company's unpadded CIK. */
  readonly cik: number
  /** The company's primary ticker. */
  readonly ticker: string
  /** The company's name as the SEC lists it. */
  readonly name: string
  /** The company's stored filings, counted per bucket. */
  readonly counts: FilingCounts
  /** The filing date of the company's newest stored filing per bucket. */
  readonly lastFiled: LastFiled
  /** The latest stored filing of base form `10-K`, or `null` when the company has none stored. */
  readonly latest10K: Latest10K | null
  /** When the company's filings were last synced, as an ISO datetime, or `null` before the first sync. */
  readonly filingsSyncedAt: string | null
}

/** One window of the summary and the count of every selected company. */
export interface FilingSummaryPage {
  /** The summaries in the window, by company name. */
  readonly items: readonly FilingSummary[]
  /** The count of every selected company, whatever the window. */
  readonly total: number
}

/**
 * The most filings one insert statement carries. A filing binds 22 values, so 500 of them bind
 * 11,000, under SQLite's default cap of 32,766 and under the 65,535 that Postgres allows and that
 * Bun's SQLite binding reaches before it refuses a statement.
 */
export const INSERT_CHUNK_SIZE = 500;

/** A cutoff as `YYYY-MM-DD`, the spelling that compares as a date when compared as text. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The base form whose latest filing the summary answers. */
const ANNUAL_FORM = '10-K';

/** The filings of one bucket: the base form itself, or every base form outside `NAMED_FORMS` for `other`. */
function inBucket(bucket: FormBucket): SQL {
  return bucket === OTHER_FORMS
    ? notInArray(filings.baseForm, [...NAMED_FORMS])
    : eq(filings.baseForm, bucket);
}

/** A `filings` row as drizzle reads it. */
type FilingRow = typeof filings.$inferSelect;

/** A `filings` row as drizzle writes it. */
type FilingInsert = typeof filings.$inferInsert;

/** A filing as a stored row: the links spread into their five columns, a copy of the items. */
function toRow(filing: Filing): FilingInsert {
  const { links, items, ...fields } = filing;
  return {
    ...fields,
    items: [...items],
    documentUrl: links.document,
    indexUrl: links.index,
    folderJsonUrl: links.folderJson,
    inlineXbrlViewerUrl: links.inlineXbrlViewer,
    rawXmlUrl: links.rawXml,
  };
}

/** The five stored link columns of a row as {@link FilingLinks}. */
function linksOf(row: Pick<FilingRow, 'documentUrl' | 'indexUrl' | 'folderJsonUrl' | 'inlineXbrlViewerUrl' | 'rawXmlUrl'>): FilingLinks {
  return {
    document: row.documentUrl,
    index: row.indexUrl,
    folderJson: row.folderJsonUrl,
    inlineXbrlViewer: row.inlineXbrlViewerUrl,
    rawXml: row.rawXmlUrl,
  };
}

/** A stored row as the {@link Filing} entity. */
function toFiling(row: FilingRow): Filing {
  const { documentUrl, indexUrl, folderJsonUrl, inlineXbrlViewerUrl, rawXmlUrl, items, ...fields } = row;
  return {
    ...fields,
    items: [...items],
    links: linksOf({ documentUrl, indexUrl, folderJsonUrl, inlineXbrlViewerUrl, rawXmlUrl }),
  };
}

/** The ordering terms of `sort`: the filing date, then the acceptance time and the accession number, all one way. */
function orderOf(sort: FilingPageFilter['sort']): SQL[] {
  const direction = sort === 'filingDate'
    ? asc
    : desc;
  const columns: AnyColumn[] = [filings.filingDate, filings.acceptedAt, filings.accessionNumber];
  return columns.map((column) => direction(column));
}

/**
 * Stores `rows`, skipping every filing whose accession number is already stored, so a re-sync
 * inserts nothing it wrote before and never overwrites a stored filing. The rows go in chunks of
 * {@link INSERT_CHUNK_SIZE} inside one `transact`, so a refused chunk leaves none of them stored.
 *
 * @param db - The client or open transaction to write through.
 * @param rows - The filings to store, each with the CIK of a stored company.
 * @returns The count of filings this call stored; the skipped ones are not counted.
 * @throws When the database refuses an insert, such as a CIK no company has; nothing is stored then.
 */
export async function insertFilings(db: Db, rows: readonly Filing[]): Promise<number> {
  if (rows.length === 0) return 0;
  return transact(db, async (tx) => {
    let inserted = 0;
    for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(start, start + INSERT_CHUNK_SIZE).map(toRow);
      const written = await tx.insert(filings).values(chunk)
        .onConflictDoNothing({ target: filings.accessionNumber })
        .returning({ accessionNumber: filings.accessionNumber });
      inserted += written.length;
    }
    return inserted;
  });
}

/**
 * Deletes the filings of the company with `cik` filed before `cutoff`. A filing on the cutoff
 * itself is kept, the same line the last-year cut draws, and other companies' filings are kept.
 *
 * @param db - The client or open transaction to write through.
 * @param cik - The company's unpadded CIK.
 * @param cutoff - The first filing date to keep, `YYYY-MM-DD`.
 * @returns The count of filings deleted.
 * @throws {RangeError} When `cutoff` is not spelled `YYYY-MM-DD`; nothing is deleted then.
 * @throws When the database refuses the delete.
 */
export async function deleteFilingsBefore(db: Db, cik: number, cutoff: string): Promise<number> {
  if (!ISO_DATE.test(cutoff)) throw new RangeError(`cutoff ${JSON.stringify(cutoff)} is not a YYYY-MM-DD date`);
  const deleted = await db.delete(filings)
    .where(and(eq(filings.cik, cik), lt(filings.filingDate, cutoff)))
    .returning({ accessionNumber: filings.accessionNumber });
  return deleted.length;
}

/**
 * One window of the filings of the company with `cik`, of one base form when `form` names it,
 * by filing date in the order `sort` names, and the count of every match. Filings of the same
 * date keep the order of their acceptance time, then of their accession number, so the windows
 * of one list never overlap. A window past the last match is empty and still carries the real
 * total. The window and the count are two reads, not one snapshot.
 *
 * @param db - The client or open transaction to read through.
 * @param filter - The CIK, the form filter, the order and the window.
 * @returns The filings in the window and the total of every match.
 * @throws When the database refuses the read.
 */
export async function pageFilings(db: Db, filter: FilingPageFilter): Promise<FilingPage> {
  const where = and(
    eq(filings.cik, filter.cik),
    filter.form === undefined
      ? undefined
      : inBucket(filter.form),
  );
  const rows = await db.select().from(filings)
    .where(where)
    .orderBy(...orderOf(filter.sort))
    .limit(filter.limit)
    .offset(filter.offset);
  const [counted] = await db.select({ total: count() }).from(filings)
    .where(where);
  return { items: rows.map(toFiling), total: counted?.total ?? 0 };
}

/** A company's counts and newest filing dates per bucket, read in one grouped query. */
interface FormStats {
  readonly counts: FilingCounts
  readonly lastFiled: LastFiled
}

/** The stats of a company with no stored filing in the bucket asked for. */
const NO_FORM_STATS: FormStats = {
  counts: { '10-K': 0, '10-Q': 0, '8-K': 0, '6-K': 0, '4': 0, '144': 0, other: 0, total: 0 },
  lastFiled: { '10-K': null, '10-Q': null, '8-K': null, '6-K': null, '4': null, '144': null, other: null },
};

/** The later of two `YYYY-MM-DD` dates, which compare as text; `null` is earlier than any date. */
function laterDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b
    ? a
    : b;
}

/**
 * The stored filings of the companies with `ciks`, counted per company and per base form, with
 * the newest filing date of each group, then summed into their buckets: a named form is its own
 * bucket, and every other base form adds into `other`, whose date is the newest of them. With
 * `bucket` set, only that bucket's filings are read, so every other bucket counts 0 and has no
 * date.
 */
async function formStatsOf(db: Db, ciks: readonly number[], bucket: FormBucket | undefined): Promise<Map<number, FormStats>> {
  const grouped = await db.select({ cik: filings.cik, baseForm: filings.baseForm, total: count(), newest: max(filings.filingDate) })
    .from(filings)
    .where(and(inArray(filings.cik, [...ciks]), bucket === undefined
      ? undefined
      : inBucket(bucket)))
    .groupBy(filings.cik, filings.baseForm);
  return grouped.reduce((byCik, group) => {
    const into = bucketOf(group.baseForm);
    const { counts, lastFiled } = byCik.get(group.cik) ?? NO_FORM_STATS;
    return new Map(byCik).set(group.cik, {
      counts: { ...counts, [into]: counts[into] + group.total, total: counts.total + group.total },
      lastFiled: { ...lastFiled, [into]: laterDate(lastFiled[into], group.newest) },
    });
  }, new Map<number, FormStats>());
}

/** The latest stored 10-K of each company with `ciks` that has one: by filing date, then acceptance time. */
async function latest10KOf(db: Db, ciks: readonly number[]): Promise<Map<number, Latest10K>> {
  const rows = await db.select({
    cik: filings.cik,
    filingDate: filings.filingDate,
    documentUrl: filings.documentUrl,
    indexUrl: filings.indexUrl,
    folderJsonUrl: filings.folderJsonUrl,
    inlineXbrlViewerUrl: filings.inlineXbrlViewerUrl,
    rawXmlUrl: filings.rawXmlUrl,
  })
    .from(filings)
    .where(and(inArray(filings.cik, [...ciks]), eq(filings.baseForm, ANNUAL_FORM)))
    .orderBy(asc(filings.cik), desc(filings.filingDate), desc(filings.acceptedAt), desc(filings.accessionNumber));
  // The rows of one company come newest first, so its first row is its latest 10-K.
  return rows.reduce((byCik, row) => (byCik.has(row.cik)
    ? byCik
    : new Map(byCik).set(row.cik, { filingDate: row.filingDate, links: linksOf(row) })), new Map<number, Latest10K>());
}

/**
 * One window of the summary of the selected companies, by name then CIK, and the count of every
 * selected company. Each summary counts the company's stored filings per bucket, amendments
 * included, with the filing date of the newest of each bucket, and answers its latest stored
 * 10-K, a `10-K/A` included, or `null`. A `form` narrows the counts and dates to that bucket
 * and keeps every selected company, so the total is the count of selected companies with or
 * without it; `latest10K` is its own data point and ignores `form`. It reads stored rows only.
 * The window, the count, the counts with their dates and the latest 10-Ks are four reads, not
 * one snapshot.
 *
 * @param db - The client or open transaction to read through.
 * @param filter - The form filter and the window.
 * @returns The summaries in the window and the count of every selected company.
 * @throws When the database refuses a read.
 */
export async function summarizeSelectedFilings(db: Db, filter: FilingSummaryFilter): Promise<FilingSummaryPage> {
  const selected = eq(companies.selected, true);
  const window = await db.select({
    cik: companies.cik,
    ticker: companies.ticker,
    name: companies.name,
    filingsSyncedAt: companies.filingsSyncedAt,
  })
    .from(companies)
    .where(selected)
    .orderBy(asc(companies.name), asc(companies.cik))
    .limit(filter.limit)
    .offset(filter.offset);
  const [counted] = await db.select({ total: count() }).from(companies)
    .where(selected);
  const total = counted?.total ?? 0;
  if (window.length === 0) return { items: [], total };
  const ciks = window.map((company) => company.cik);
  const [stats, latest] = await Promise.all([formStatsOf(db, ciks, filter.form), latest10KOf(db, ciks)]);
  const items = window.map((company): FilingSummary => ({
    cik: company.cik,
    ticker: company.ticker,
    name: company.name,
    ...(stats.get(company.cik) ?? NO_FORM_STATS),
    latest10K: latest.get(company.cik) ?? null,
    filingsSyncedAt: company.filingsSyncedAt === null
      ? null
      : company.filingsSyncedAt.toISOString(),
  }));
  return { items, total };
}
