import { z } from 'zod';

/**
 * A company the service tracks, keyed by its unpadded SEC CIK. The fields read from the
 * submissions document (`exchanges`, `sic`, `sicDescription`, `category`, `fiscalYearEnd`)
 * stay empty, `[]` or `null`, until the company's first sync. Strict, so a stray field is
 * refused.
 */
export const Company = z.strictObject({
  /** The SEC Central Index Key, unpadded: the primary key. */
  cik: z.number().int(),
  /** The CIK padded to ten digits, as the SEC's URLs and file names spell it. */
  cik10: z.string().length(10),
  /** The primary ticker: the first one `company_tickers.json` lists for the CIK. */
  ticker: z.string(),
  /** The company's name. */
  name: z.string(),
  /** Whether the company is in the summary. */
  selected: z.boolean(),
  /** The exchanges the company trades on, `[]` until the first sync. */
  exchanges: z.array(z.string()),
  /** The Standard Industrial Classification code. */
  sic: z.string().nullable(),
  /** The text of the SIC code. */
  sicDescription: z.string().nullable(),
  /** The SEC filer category, such as `Large Accelerated Filer`. */
  category: z.string().nullable(),
  /** The fiscal year end as `MMDD`. */
  fiscalYearEnd: z.string().nullable(),
  /** When the company's filings were last synced, as an ISO datetime. */
  filingsSyncedAt: z.string().nullable(),
});

/** A company as {@link Company} parses it. */
export type Company = z.infer<typeof Company>;

/**
 * One ticker of a company: a CIK may trade under several, and each names the company.
 * Strict, so a stray field is refused.
 */
export const CompanyTicker = z.strictObject({
  /** The ticker: the primary key. */
  ticker: z.string(),
  /** The CIK of the company the ticker names. */
  cik: z.number().int(),
});

/** A company ticker as {@link CompanyTicker} parses it. */
export type CompanyTicker = z.infer<typeof CompanyTicker>;

/**
 * Pads a CIK to the ten digits the SEC's URLs and file names use.
 *
 * @param cik - The unpadded CIK, such as `320193`.
 * @returns The CIK as ten digits, such as `0000320193`.
 */
export const toCik10 = (cik: number): string => String(cik).padStart(10, '0');
