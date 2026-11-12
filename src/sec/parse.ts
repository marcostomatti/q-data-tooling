/**
 * The parsers that turn an EDGAR submissions document into `Filing` rows, per "Code snippets /
 * parsing algorithms" in `setup-prompt.md`. The document schemas are loose on purpose, since
 * EDGAR adds fields without notice: an unknown key is accepted and dropped, never refused. Only
 * the `Filing` they produce is strict.
 *
 * EDGAR sends the filings as columns, one array per field; `columnsToRows` zips them into rows,
 * `withinRetention` keeps the last year of them, and `toFiling` normalizes one row, with
 * `splitForm` and `buildLinks` for the form and the SEC links. Every function is pure, and the
 * one that reads the time takes `now`.
 *
 * @module
 */

import { z } from 'zod';

import { Filing, type FilingLinks } from '../entities/filing.ts';

/** How many days of filings are kept, counted back from the sync. */
export const RETENTION_DAYS = 365;

const MS_PER_DAY = 86_400_000;

/** Where every filing's folder sits, under the company CIK and the dashless accession. */
const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';

/** The inline XBRL viewer, which takes a document path after `doc=`. */
const INLINE_XBRL_VIEWER = 'https://www.sec.gov/ix?doc=';

/** The stylesheet folder EDGAR puts before a rendered XML form, such as `xslF345X06/`. */
const XSL_PREFIX = /^xsl[^/]+\//;

/** The suffix that marks an amendment, as in `10-K/A`. */
const AMENDMENT_SUFFIX = '/A';

/**
 * One address of the submissions header. Every field may be `null`; `isForeignLocation` is
 * `0`, `1` or `null`.
 */
export const Address = z.object({
  street1: z.string().nullable(),
  street2: z.string().nullable(),
  city: z.string().nullable(),
  stateOrCountry: z.string().nullable(),
  zipCode: z.string().nullable(),
  stateOrCountryDescription: z.string().nullable(),
  isForeignLocation: z.number().nullable(),
  foreignStateTerritory: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
});

/**
 * The filings as EDGAR sends them: one array per field, every array the same length, index `i`
 * of each describing the same filing. `filings.recent` and every overflow file share it.
 * `isXBRLNumeric` is `null` on some rows, such as an UPLOAD; the parsers drop it.
 */
export const FilingColumns = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  reportDate: z.array(z.string()),
  acceptanceDateTime: z.array(z.string()),
  act: z.array(z.string()),
  form: z.array(z.string()),
  fileNumber: z.array(z.string()),
  filmNumber: z.array(z.string()),
  items: z.array(z.string()),
  core_type: z.array(z.string()),
  size: z.array(z.number()),
  isXBRL: z.array(z.number()),
  isInlineXBRL: z.array(z.number()),
  isXBRLNumeric: z.array(z.number().nullable()),
  primaryDocument: z.array(z.string()),
  primaryDocDescription: z.array(z.string()),
});

/** The filing columns as {@link FilingColumns} parses them. */
export type FilingColumns = z.infer<typeof FilingColumns>;

/**
 * One overflow file of older filings. Only the last year is kept, so these are never fetched;
 * the schema is here so that a document listing them still parses.
 */
export const OverflowFileRef = z.object({
  name: z.string(),
  filingCount: z.number(),
  filingFrom: z.string(),
  filingTo: z.string(),
});

/**
 * The header of a submissions document, `data.sec.gov/submissions/CIK{cik10}.json`, with its
 * filings. `cik` is zero-padded here, `"0000320193"`, unlike everywhere else in the service.
 */
export const SubmissionsHeader = z.object({
  cik: z.string(),
  entityType: z.string(),
  sic: z.string(),
  sicDescription: z.string(),
  ownerOrg: z.string(),
  insiderTransactionForOwnerExists: z.number(),
  insiderTransactionForIssuerExists: z.number(),
  name: z.string(),
  tickers: z.array(z.string()),
  exchanges: z.array(z.string()),
  ein: z.string().nullable(),
  lei: z.string().nullable(),
  description: z.string(),
  website: z.string(),
  investorWebsite: z.string(),
  category: z.string(),
  fiscalYearEnd: z.string(),
  stateOfIncorporation: z.string(),
  stateOfIncorporationDescription: z.string(),
  addresses: z.object({ mailing: Address, business: Address }),
  phone: z.string(),
  flags: z.string(),
  formerNames: z.array(z.object({ name: z.string(), from: z.string(), to: z.string() })),
  filings: z.object({ recent: FilingColumns, files: z.array(OverflowFileRef) }),
});

/** A submissions document as {@link SubmissionsHeader} parses it. */
export type SubmissionsHeader = z.infer<typeof SubmissionsHeader>;

/** One filing as EDGAR describes it: the values at one index of every {@link FilingColumns} array. */
export type RawRow = { [K in keyof FilingColumns]: FilingColumns[K][number] };

/**
 * Zips the column arrays into one row per filing.
 *
 * @param cols - The filing columns, as `filings.recent` holds them.
 * @returns One row per filing, in EDGAR's order.
 * @throws Error when the arrays differ in length, naming the ones that differ from
 *   `accessionNumber`, since zipping them would pair values of different filings.
 */
export function columnsToRows(cols: FilingColumns): RawRow[] {
  const keys = Object.keys(cols) as (keyof FilingColumns)[];
  const length = cols.accessionNumber.length;
  const bad = keys.filter((k) => cols[k].length !== length);
  if (bad.length > 0) {
    throw new Error(`EDGAR columns misaligned: ${bad.join(', ')}`);
  }
  return Array.from({ length }, (_, i) => Object.fromEntries(keys.map((k) => [k, cols[k][i]])) as RawRow);
}

/**
 * The oldest filing date kept: `RETENTION_DAYS` before `now`, in UTC. A filing on this date is
 * kept, one the day before is not.
 *
 * @param now - The time of the sync.
 * @returns The cutoff as `YYYY-MM-DD`.
 */
export function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY).toISOString()
    .slice(0, 10);
}

/**
 * Keeps the rows filed on or after {@link retentionCutoff}.
 *
 * @param rows - The rows to cut.
 * @param now - The time of the sync.
 * @returns The rows of the last year, in their order. `YYYY-MM-DD` dates compare as text.
 */
export function withinRetention(rows: readonly RawRow[], now: Date): RawRow[] {
  const cutoff = retentionCutoff(now);
  return rows.filter((r) => r.filingDate >= cutoff);
}

/**
 * Splits a form into its base form and whether it is an amendment: `10-K/A` is the `10-K` base
 * form with `isAmendment: true`, and any other form is its own base form.
 *
 * @param form - The form as filed.
 * @returns The base form and the amendment flag.
 */
export function splitForm(form: string): { baseForm: string, isAmendment: boolean } {
  const isAmendment = form.endsWith(AMENDMENT_SUFFIX);
  return {
    baseForm: isAmendment
      ? form.slice(0, -AMENDMENT_SUFFIX.length)
      : form,
    isAmendment,
  };
}

/**
 * Builds a filing's SEC links per "Link templates". The folder is keyed by the company's CIK,
 * never by the accession's prefix, which may be a filing agent's.
 *
 * @param cik - The company's unpadded CIK.
 * @param accession - The accession number, with its dashes.
 * @param primaryDocument - The primary document's path in the folder.
 * @param isInlineXbrl - Whether the filing has inline XBRL, which gives it a viewer link.
 * @returns The five links; `inlineXbrlViewer` is `null` without inline XBRL, and `rawXml` is
 *   `null` unless the primary document sits under an `xsl…/` folder.
 */
export function buildLinks(cik: number, accession: string, primaryDocument: string, isInlineXbrl: boolean): FilingLinks {
  const folderPath = `/Archives/edgar/data/${cik}/${accession.replaceAll('-', '')}`;
  const folder = `${ARCHIVES}/${cik}/${accession.replaceAll('-', '')}`;
  return {
    document: `${folder}/${primaryDocument}`,
    index: `${folder}/${accession}-index.htm`,
    folderJson: `${folder}/index.json`,
    inlineXbrlViewer: isInlineXbrl
      ? `${INLINE_XBRL_VIEWER}${folderPath}/${primaryDocument}`
      : null,
    rawXml: XSL_PREFIX.test(primaryDocument)
      ? `${folder}/${primaryDocument.replace(XSL_PREFIX, '')}`
      : null,
  };
}

/** `null` for EDGAR's empty string, the value itself otherwise. */
const emptyToNull = (s: string): string | null => (s === ''
  ? null
  : s);

/**
 * Normalizes one row into a `Filing`: empty strings become `null`, `items` becomes an array,
 * the `0`/`1` flags become booleans and the links are built. `core_type` and `isXBRLNumeric`
 * are dropped; only `form` decides the base form.
 *
 * @param cik - The company's unpadded CIK, which the row does not carry.
 * @param r - The row, as {@link columnsToRows} gives it.
 * @returns The filing, parsed by the strict `Filing` schema.
 * @throws ZodError when the result breaks `Filing`, such as an accession number that is not
 *   `##########-##-######` or a size that is not an integer.
 */
export function toFiling(cik: number, r: RawRow): Filing {
  const isInlineXbrl = r.isInlineXBRL === 1;
  return Filing.parse({
    accessionNumber: r.accessionNumber,
    cik,
    form: r.form,
    ...splitForm(r.form),
    filingDate: r.filingDate,
    reportDate: emptyToNull(r.reportDate),
    acceptedAt: r.acceptanceDateTime,
    act: emptyToNull(r.act),
    fileNumber: emptyToNull(r.fileNumber),
    filmNumber: emptyToNull(r.filmNumber),
    items: r.items === ''
      ? []
      : r.items.split(','),
    sizeBytes: r.size,
    isXbrl: r.isXBRL === 1,
    isInlineXbrl,
    primaryDocument: r.primaryDocument,
    description: emptyToNull(r.primaryDocDescription),
    links: buildLinks(cik, r.accessionNumber, r.primaryDocument, isInlineXbrl),
  });
}
