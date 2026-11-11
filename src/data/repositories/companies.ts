/**
 * The companies repository: the drizzle queries over `companies` and `company_tickers` that the
 * companies and filings flows read through their injected stores.
 *
 * A company is answered as the {@link Company} entity: `filingsSyncedAt` as an ISO datetime or
 * `null`, `exchanges` as an array. A ticker is resolved through `company_tickers`, so a secondary
 * ticker such as `AEMRF` names the same company as its primary `AEM`.
 *
 * @module
 */

import type { Db } from './db.ts';
import type { Company } from '../../entities/company.ts';

import { and, asc, count, eq, exists, inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { companies, companyTickers } from '../active.ts';

/** The filters and the window of a company list. */
export interface CompanyListFilter {
  /**
   * A ticker prefix or a part of the name, matched in any case, or `undefined` to match every
   * company. A company matches when any of its tickers starts with it or its name contains it.
   */
  readonly q: string | undefined
  /** Keep only the companies in the summary (`true`) or out of it (`false`), or both (`undefined`). */
  readonly selected: boolean | undefined
  /** The count of matching companies to skip. */
  readonly offset: number
  /** The most companies to return. */
  readonly limit: number
}

/** One window of a company list and the count of every match. */
export interface CompanyPage {
  /** The companies in the window, by name. */
  readonly items: readonly Company[]
  /** The count of every matching company, whatever the window. */
  readonly total: number
}

/**
 * The header fields a sync reads from the submissions document. `syncedAt` becomes the
 * company's `filingsSyncedAt`.
 */
export interface CompanyHeaderUpdate {
  /** The exchanges the company trades on. */
  readonly exchanges: readonly string[]
  /** The Standard Industrial Classification code. */
  readonly sic: string | null
  /** The text of the SIC code. */
  readonly sicDescription: string | null
  /** The SEC filer category. */
  readonly category: string | null
  /** The fiscal year end as `MMDD`. */
  readonly fiscalYearEnd: string | null
  /** When the sync ran. */
  readonly syncedAt: Date
}

/** A `companies` row as drizzle reads it. */
type CompanyRow = typeof companies.$inferSelect;

/** The character that escapes `%`, `_` and itself in a `like` pattern built from `q`. */
const LIKE_ESCAPE = '\\';

/** `text` with the `like` wildcards and the escape character escaped, so each matches itself. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `${LIKE_ESCAPE}${character}`);
}

/**
 * A case-insensitive `like` of `column` against `pattern`. Both sides are lowered in SQL because
 * Postgres's `like` is case-sensitive while SQLite's is not, so the one condition matches the same
 * rows on either dialect. The `escape` clause is spelled out, because SQLite has no default one.
 */
function likeAnyCase(column: AnyColumn, pattern: string): SQL {
  return sql`lower(${column}) like lower(${pattern}) escape ${LIKE_ESCAPE}`;
}

/** The condition `q` sets: a ticker of the company starts with it, or its name contains it. */
function matchesQuery(db: Db, q: string): SQL | undefined {
  const escaped = escapeLike(q);
  const tickerPrefix = db.select({ ticker: companyTickers.ticker }).from(companyTickers)
    .where(and(eq(companyTickers.cik, companies.cik), likeAnyCase(companyTickers.ticker, `${escaped}%`)));
  return or(exists(tickerPrefix), likeAnyCase(companies.name, `%${escaped}%`));
}

/** The `where` of a list: every filter the caller set, joined with `and`. */
function listCondition(db: Db, filter: CompanyListFilter): SQL | undefined {
  return and(
    filter.q === undefined
      ? undefined
      : matchesQuery(db, filter.q),
    filter.selected === undefined
      ? undefined
      : eq(companies.selected, filter.selected),
  );
}

/** A stored row as the {@link Company} entity: the sync time as an ISO datetime, a copy of the exchanges. */
function toCompany(row: CompanyRow): Company {
  return {
    cik: row.cik,
    cik10: row.cik10,
    ticker: row.ticker,
    name: row.name,
    selected: row.selected,
    exchanges: [...row.exchanges],
    sic: row.sic,
    sicDescription: row.sicDescription,
    category: row.category,
    fiscalYearEnd: row.fiscalYearEnd,
    filingsSyncedAt: row.filingsSyncedAt === null
      ? null
      : row.filingsSyncedAt.toISOString(),
  };
}

/** The CIKs `ticker` names: at most one, since the ticker is `company_tickers`' primary key. */
function cikOf(db: Db, ticker: string) {
  return db.select({ cik: companyTickers.cik }).from(companyTickers)
    .where(eq(companyTickers.ticker, ticker));
}

/**
 * One window of companies by name, filtered by `q` and `selected`, and the count of every
 * match. Companies with the same name keep CIK order, so the windows of one list never overlap.
 * A window past the last match is empty and still carries the real total. The window and the
 * count are two reads, not one snapshot: a write between them can make the total disagree
 * with the window by that write.
 *
 * @param db - The client or open transaction to read through.
 * @param filter - The filters and the window.
 * @returns The companies in the window and the total of every match.
 * @throws When the database refuses the read.
 */
export async function listCompanies(db: Db, filter: CompanyListFilter): Promise<CompanyPage> {
  const where = listCondition(db, filter);
  const rows = await db.select().from(companies)
    .where(where)
    .orderBy(asc(companies.name), asc(companies.cik))
    .limit(filter.limit)
    .offset(filter.offset);
  const [counted] = await db.select({ total: count() }).from(companies)
    .where(where);
  return { items: rows.map(toCompany), total: counted?.total ?? 0 };
}

/**
 * The company that trades under `ticker`, primary or secondary. The match is exact: the
 * contracts upper-case a ticker before it reaches here, and the SEC spells tickers upper case.
 *
 * @param db - The client or open transaction to read through.
 * @param ticker - The ticker, as the SEC spells it.
 * @returns The company, or `undefined` when no company trades under the ticker.
 * @throws When the database refuses the read.
 */
export async function findCompanyByTicker(db: Db, ticker: string): Promise<Company | undefined> {
  const [row] = await db.select().from(companies)
    .where(inArray(companies.cik, cikOf(db, ticker)));
  return row === undefined
    ? undefined
    : toCompany(row);
}

/**
 * Sets whether the company that trades under `ticker` is in the summary. The flag is set as
 * given, never toggled, so setting it twice leaves it as the first call did.
 *
 * @param db - The client or open transaction to write through.
 * @param ticker - The ticker, primary or secondary, as the SEC spells it.
 * @param selected - Whether the company is in the summary.
 * @returns The company after the change, or `undefined` when no company trades under the ticker.
 * @throws When the database refuses the write.
 */
export async function setCompanySelected(db: Db, ticker: string, selected: boolean): Promise<Company | undefined> {
  const [row] = await db.update(companies).set({ selected })
    .where(inArray(companies.cik, cikOf(db, ticker)))
    .returning();
  return row === undefined
    ? undefined
    : toCompany(row);
}

/**
 * Writes the header fields a sync read from the submissions document, and `filingsSyncedAt`,
 * onto the company with `cik`. The CIK, ticker, name and `selected` stay as they are.
 *
 * @param db - The client or open transaction to write through.
 * @param cik - The company's unpadded CIK.
 * @param header - The header fields and the time of the sync.
 * @returns The company after the change, or `undefined` when no company has the CIK.
 * @throws When the database refuses the write.
 */
export async function updateCompanyHeader(db: Db, cik: number, header: CompanyHeaderUpdate): Promise<Company | undefined> {
  const [row] = await db.update(companies)
    .set({
      exchanges: [...header.exchanges],
      sic: header.sic,
      sicDescription: header.sicDescription,
      category: header.category,
      fiscalYearEnd: header.fiscalYearEnd,
      filingsSyncedAt: header.syncedAt,
    })
    .where(eq(companies.cik, cik))
    .returning();
  return row === undefined
    ? undefined
    : toCompany(row);
}
