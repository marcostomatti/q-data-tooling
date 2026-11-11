import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A company the SEC lists in `company_tickers.json`, keyed by its unpadded CIK. The seed writes
 * the CIK, the padded CIK, the primary ticker and the name; the header fields read from the
 * submissions document (`exchanges`, `sic`, `sic_description`, `category`, `fiscal_year_end`)
 * stay `[]` or null until the company's first sync. The index on `name` serves the alphabetical
 * list, and the one on `selected` serves the summary's selected companies.
 */
export const companies = pgTable('companies', {
  /** The SEC Central Index Key, unpadded: the primary key. */
  cik: integer().primaryKey(),
  /** The CIK padded to ten digits, as the SEC's URLs and file names spell it. */
  cik10: text().notNull()
    .unique(),
  /** The primary ticker: the first one `company_tickers.json` lists for the CIK. */
  ticker: text().notNull(),
  name: text().notNull(),
  /** Whether the company is in the summary. */
  selected: boolean().notNull()
    .default(false),
  /** The exchanges the company trades on, as a jsonb array of strings, `[]` until the first sync. */
  exchanges: jsonb().$type<string[]>()
    .notNull()
    .default([]),
  /** The Standard Industrial Classification code. */
  sic: text(),
  /** The text of the SIC code. */
  sicDescription: text('sic_description'),
  /** The SEC filer category, such as `Large Accelerated Filer`. */
  category: text(),
  /** The fiscal year end as `MMDD`. */
  fiscalYearEnd: text('fiscal_year_end'),
  /** When the company's filings were last synced, null before the first sync. */
  filingsSyncedAt: timestamp('filings_synced_at', { withTimezone: true }),
}, (table) => [
  index('companies_name_idx').on(table.name),
  index('companies_selected_idx').on(table.selected),
]);

/**
 * Every ticker `company_tickers.json` lists, each pointing at the company that trades under it.
 * A company with several tickers, such as CIK 2809 with `AEM` and `AEMRF`, has one row per
 * ticker, so a secondary ticker resolves to the same company as its primary.
 */
export const companyTickers = pgTable('company_tickers', {
  /** The ticker as the SEC spells it: the primary key. */
  ticker: text().primaryKey(),
  /** The CIK of the company the ticker belongs to; deleting the company deletes its tickers. */
  cik: integer().notNull()
    .references(() => companies.cik, { onDelete: 'cascade' }),
});
