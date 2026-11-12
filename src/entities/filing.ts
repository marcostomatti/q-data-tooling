import { z } from 'zod';

/**
 * The base forms the service counts and filters by name, in the order the summary shows them:
 * the three core forms, then the three filed most often after them across eleven companies'
 * last year (1,349 filings, read from SEC on 2026-11-12): Form `4`, an insider's trade (558);
 * `6-K`, a foreign issuer's current report (154); and Form `144`, a notice of a planned sale of
 * restricted stock (127). `6-K` sits beside `8-K`, the report it stands in for.
 *
 * Read the order from this list, never from `NamedForm.options`: zod 4 builds an enum's options
 * from an object, and an object lists integer-like keys such as `4` and `144` first.
 */
export const NAMED_FORMS = ['10-K', '10-Q', '8-K', '6-K', '4', '144'] as const;

/** The bucket every base form outside {@link NamedForm} counts and filters under. */
export const OTHER_FORMS = 'other';

/**
 * A base form the service names, one of {@link NAMED_FORMS}. The service stores every form of
 * the last year; an amendment such as `10-K/A` counts under its base form, with
 * `isAmendment: true`.
 */
export const NamedForm = z.enum(NAMED_FORMS);

/** One of the base forms {@link NamedForm} names. */
export type NamedForm = z.infer<typeof NamedForm>;

/**
 * What a form filter keeps and a summary counts by: one {@link NamedForm}, or {@link OTHER_FORMS}
 * for every other base form, such as `SCHEDULE 13G` or `424B2`.
 */
export const FormBucket = z.enum([...NAMED_FORMS, OTHER_FORMS]);

/** Every {@link FormBucket}, in the order the summary shows them: {@link NAMED_FORMS}, then `other`. */
export const FORM_BUCKETS: readonly FormBucket[] = [...NAMED_FORMS, OTHER_FORMS];

/** One of the buckets {@link FormBucket} names. */
export type FormBucket = z.infer<typeof FormBucket>;

/**
 * The bucket a base form counts under.
 *
 * @param baseForm - The form without its `/A`, such as `10-K` or `SCHEDULE 13G`.
 * @returns The form itself when {@link NamedForm} names it, {@link OTHER_FORMS} otherwise.
 */
export function bucketOf(baseForm: string): FormBucket {
  const named = NamedForm.safeParse(baseForm);
  return named.success
    ? named.data
    : OTHER_FORMS;
}

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
