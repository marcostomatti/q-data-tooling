import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * A company the SEC lists in `company_tickers.json`, keyed by its unpadded CIK. The seed writes
 * the CIK, the padded CIK, the primary ticker and the name; the header fields read from the
 * submissions document (`exchanges`, `sic`, `sic_description`, `category`, `fiscal_year_end`)
 * stay `[]` or null until the company's first sync. The index on `name` serves the alphabetical
 * list, and the one on `selected` serves the summary's selected companies.
 */
export const companies = sqliteTable('companies', {
  /** The SEC Central Index Key, unpadded: the primary key. */
  cik: integer().primaryKey(),
  /** The CIK padded to ten digits, as the SEC's URLs and file names spell it. */
  cik10: text().notNull()
    .unique(),
  /** The primary ticker: the first one `company_tickers.json` lists for the CIK. */
  ticker: text().notNull(),
  name: text().notNull(),
  /** Whether the company is in the summary; stored as 0 or 1. */
  selected: integer({ mode: 'boolean' }).notNull()
    .default(false),
  /** The exchanges the company trades on, as a JSON array of strings, `[]` until the first sync. */
  exchanges: text({ mode: 'json' }).$type<string[]>()
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
  filingsSyncedAt: integer('filings_synced_at', { mode: 'timestamp' }),
}, (table) => [
  index('companies_name_idx').on(table.name),
  index('companies_selected_idx').on(table.selected),
]);
