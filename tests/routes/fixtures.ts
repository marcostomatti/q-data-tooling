/**
 * The fixed companies and filings the route tests hand to fake stores, or store in a test
 * database. Each passes its entity, and each copies public SEC facts: Apple's and Microsoft's
 * header fields, and Apple's 10-K of 2026-11-03 as "Example response data" in `setup-prompt.md`
 * normalizes it. The fields a sync fills stay empty, as they do for a company never synced.
 *
 * @module
 */

import type { Company } from '../../src/entities/company.ts';
import type { Filing } from '../../src/entities/filing.ts';

/** Apple, selected, and Microsoft, not selected. */
export const FIXED_COMPANIES: readonly Company[] = [
  {
    cik: 320193,
    cik10: '0000320193',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    selected: true,
    exchanges: [],
    sic: null,
    sicDescription: null,
    category: null,
    fiscalYearEnd: null,
    filingsSyncedAt: null,
  },
  {
    cik: 789019,
    cik10: '0000789019',
    ticker: 'MSFT',
    name: 'MICROSOFT CORP',
    selected: false,
    exchanges: [],
    sic: null,
    sicDescription: null,
    category: null,
    fiscalYearEnd: null,
    filingsSyncedAt: null,
  },
];

/** Apple's 10-K of 2026-11-03. */
export const APPLE_10K: Filing = {
  accessionNumber: '0000320193-26-000026',
  cik: 320193,
  form: '10-K',
  baseForm: '10-K',
  isAmendment: false,
  filingDate: '2026-11-03',
  reportDate: '2026-09-26',
  acceptedAt: '2026-11-03T13:05:15.000Z',
  act: '34',
  fileNumber: '001-36743',
  filmNumber: '261514222',
  items: [],
  sizeBytes: 10902198,
  isXbrl: true,
  isInlineXbrl: true,
  primaryDocument: 'aapl-20260926.htm',
  description: '10-K',
  links: {
    document: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm',
    index: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm',
    folderJson: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/index.json',
    inlineXbrlViewer: 'https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm',
    rawXml: null,
  },
};

/** The fixed filings, newest first: {@link APPLE_10K} alone. */
export const FIXED_FILINGS: readonly Filing[] = [APPLE_10K];
