import { z } from 'zod';

/**
 * The base forms the service stores. An amendment such as `10-K/A` is counted under its base
 * form, with `isAmendment: true`.
 */
export const TrackedForm = z.enum(['10-K', '10-Q', '8-K']);

/** One of the base forms {@link TrackedForm} names. */
export type TrackedForm = z.infer<typeof TrackedForm>;

/**
 * The SEC links of one filing, built once at ingest. The two XBRL links are `null` when the
 * filing has no inline XBRL or no raw XML. Strict, so a stray field is refused.
 */
export const FilingLinks = z.object({
  /** The primary document. */
  document: z.string().url(),
  /** The filing's index page. */
  index: z.string().url(),
  /** The JSON listing of the filing's folder. */
  folderJson: z.string().url(),
  /** The inline XBRL viewer, or `null` without inline XBRL. */
  inlineXbrlViewer: z.string().url()
    .nullable(),
  /** The raw XBRL instance, or `null` without one. */
  rawXml: z.string().url()
    .nullable(),
}).strict();

/** A filing's links as {@link FilingLinks} parses them. */
export type FilingLinks = z.infer<typeof FilingLinks>;

/**
 * One filing, normalized at ingest: empty strings are `null`, `0`/`1` flags are booleans and
 * `items` is split into an array. Strict, so a stray field is refused.
 */
export const Filing = z.object({
  /** The accession number, `##########-##-######`: the primary key. */
  accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  /** The CIK of the company that filed it. */
  cik: z.number().int(),
  /** The form as filed, kept verbatim, such as `10-K/A`. */
  form: z.string(),
  /** The form without its `/A`, such as `10-K`. */
  baseForm: z.string(),
  /** Whether the form is an amendment, a `/A` form. */
  isAmendment: z.boolean(),
  /** The filing date, `YYYY-MM-DD`. */
  filingDate: z.string(),
  /** The end of the period the filing reports on, `YYYY-MM-DD`. */
  reportDate: z.string().nullable(),
  /** When the SEC accepted the filing, as an ISO datetime. */
  acceptedAt: z.string(),
  /** The act the filing is made under, such as `34`. */
  act: z.string().nullable(),
  /** The SEC file number. */
  fileNumber: z.string().nullable(),
  /** The SEC film number. */
  filmNumber: z.string().nullable(),
  /** The 8-K items, such as `["8.01", "9.01"]`. */
  items: z.array(z.string()),
  /** The filing's size in bytes. */
  sizeBytes: z.number().int(),
  /** Whether the filing carries XBRL. */
  isXbrl: z.boolean(),
  /** Whether the filing carries inline XBRL. */
  isInlineXbrl: z.boolean(),
  /** The file name of the primary document. */
  primaryDocument: z.string(),
  /** The primary document's description. */
  description: z.string().nullable(),
  /** The filing's SEC links. */
  links: FilingLinks,
}).strict();

/** A filing as {@link Filing} parses it. */
export type Filing = z.infer<typeof Filing>;
