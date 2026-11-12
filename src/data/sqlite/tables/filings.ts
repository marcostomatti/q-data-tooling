import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { companies } from './companies.ts';

/**
 * One SEC filing of a stored company, normalized at ingest and keyed by its accession number.
 * Only the last year of a company's `10-K`, `10-Q` and `8-K` filings, amendments included, is
 * stored. The five SEC links are built once at ingest and stored, so a read returns them with no
 * extra work. The index on `(cik, filing_date DESC)` serves the paginated list, and the one on
 * `(cik, base_form)` serves the form filter and the summary.
 */
export const filings = sqliteTable('filings', {
  /** The accession number, `##########-##-######`: the primary key. */
  accessionNumber: text('accession_number').primaryKey(),
  /** The CIK of the company the filing belongs to; deleting the company deletes its filings. */
  cik: integer().notNull()
    .references(() => companies.cik, { onDelete: 'cascade' }),
  /** The form as filed, kept verbatim, such as `10-K/A`. */
  form: text().notNull(),
  /** The form without its `/A`, such as `10-K`: what the filter and the summary count by. */
  baseForm: text('base_form').notNull(),
  /** Whether the form is an amendment, a `/A` form; stored as 0 or 1. */
  isAmendment: integer('is_amendment', { mode: 'boolean' }).notNull(),
  /** The filing date as `YYYY-MM-DD`, which sorts as a date. */
  filingDate: text('filing_date').notNull(),
  /** The end of the period the filing reports on, `YYYY-MM-DD`, or null when the SEC gives none. */
  reportDate: text('report_date'),
  /** When the SEC accepted the filing, as an ISO datetime. */
  acceptedAt: text('accepted_at').notNull(),
  /** The act the filing is made under, such as `34`. */
  act: text(),
  /** The SEC file number. */
  fileNumber: text('file_number'),
  /** The SEC film number. */
  filmNumber: text('film_number'),
  /** The 8-K items as a JSON array of strings, such as `["8.01","9.01"]`, `[]` when none. */
  items: text({ mode: 'json' }).$type<string[]>()
    .notNull()
    .default([]),
  /** The filing's size in bytes. */
  sizeBytes: integer('size_bytes').notNull(),
  /** Whether the filing carries XBRL; stored as 0 or 1. */
  isXbrl: integer('is_xbrl', { mode: 'boolean' }).notNull(),
  /** Whether the filing carries inline XBRL; stored as 0 or 1. */
  isInlineXbrl: integer('is_inline_xbrl', { mode: 'boolean' }).notNull(),
  /** The file name of the primary document. */
  primaryDocument: text('primary_document').notNull(),
  /** The primary document's description, `primaryDocDescription` in the SEC file. */
  description: text(),
  /** The primary document's URL. */
  documentUrl: text('document_url').notNull(),
  /** The filing index page's URL. */
  indexUrl: text('index_url').notNull(),
  /** The URL of the JSON listing of the filing's folder. */
  folderJsonUrl: text('folder_json_url').notNull(),
  /** The inline XBRL viewer's URL, or null without inline XBRL. */
  inlineXbrlViewerUrl: text('inline_xbrl_viewer_url'),
  /** The raw XML's URL, or null when the primary document has no `xsl…/` segment. */
  rawXmlUrl: text('raw_xml_url'),
}, (table) => [
  // sqlite-core's index builder has no `.desc()`, so the direction is spelled as SQL.
  index('filings_cik_filing_date_idx').on(table.cik, sql`${table.filingDate} desc`),
  index('filings_cik_base_form_idx').on(table.cik, table.baseForm),
]);
