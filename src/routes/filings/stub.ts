import type { CompanySummary } from './contract.ts';
import type { FilingPageQuery, FilingSlice } from './list.flow.ts';
import type { SummaryQuery, SummarySlice } from './summary.flow.ts';
import type { Company } from '../../entities/company.ts';
import type { Filing } from '../../entities/filing.ts';

import { STUB_COMPANIES } from '../companies/stub.ts';

/**
 * The fixed filings the stub store answers with until the Database and seed stage wires the
 * flows to a repository: Apple's 10-K of 2026-11-03, copied from the public SEC submissions
 * document as "Example response data" in `setup-prompt.md` normalizes it.
 */
export const STUB_FILINGS: readonly Filing[] = [
  {
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
  },
];

/** The fixed filings of one company, newest first. */
function filingsOf(cik: number): Filing[] {
  return STUB_FILINGS.filter((filing) => filing.cik === cik)
    .toSorted((a, b) => b.filingDate.localeCompare(a.filingDate));
}

/** The summary of one company over its fixed filings: the counts per base form and its latest 10-K. */
function summaryOf(company: Company): CompanySummary {
  const filings = filingsOf(company.cik);
  const countOf = (form: string): number => filings.filter((filing) => filing.baseForm === form).length;
  const latest = filings.find((filing) => filing.baseForm === '10-K');
  return {
    cik: company.cik,
    ticker: company.ticker,
    name: company.name,
    counts: { '10-K': countOf('10-K'), '10-Q': countOf('10-Q'), '8-K': countOf('8-K'), total: filings.length },
    latest10K: latest === undefined
      ? null
      : { filingDate: latest.filingDate, links: latest.links },
    filingsSyncedAt: company.filingsSyncedAt,
  };
}

/**
 * The companies store the filings list reads in this stage, over `STUB_COMPANIES` from the
 * companies stub. It resolves a primary ticker only: the fixture holds no secondary ones.
 */
export const companyLookupStubStore = {
  /**
   * The fixed company with the ticker.
   *
   * @param ticker - The upper-case ticker.
   * @returns The company, or `undefined` when no fixed company has the ticker.
   */
  async findByTicker(ticker: string): Promise<Company | undefined> {
    return STUB_COMPANIES.find((company) => company.ticker === ticker);
  },
};

/**
 * The filings store the filings flows read in this stage, over {@link STUB_FILINGS}. It filters,
 * sorts and pages the fixed rows as the repository will, and keeps nothing.
 */
export const filingStubStore = {
  /**
   * The fixed filings of one company matching the query, in its order and the window it names.
   * `form` matches the base form, so an amendment is kept under its form.
   *
   * @param query - The CIK, the form filter, the order and the window.
   * @returns The rows in the window and the count of every match.
   */
  async page(query: FilingPageQuery): Promise<FilingSlice> {
    const newestFirst = filingsOf(query.cik)
      .filter((filing) => query.form === undefined || filing.baseForm === query.form);
    const ordered = query.sort === '-filingDate'
      ? newestFirst
      : newestFirst.toReversed();
    return { items: ordered.slice(query.offset, query.offset + query.limit), total: ordered.length };
  },

  /**
   * The summaries of the selected fixed companies, by name, in the window the query names. A
   * `form` keeps only the companies with at least one filing of that base form, the reading the
   * repository is to confirm.
   *
   * @param query - The form filter and the window.
   * @returns The summaries in the window and the count of every match.
   */
  async summary(query: SummaryQuery): Promise<SummarySlice> {
    const matching = STUB_COMPANIES.filter((company) => company.selected)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map(summaryOf)
      .filter((summary) => query.form === undefined || summary.counts[query.form] > 0);
    return { items: matching.slice(query.offset, query.offset + query.limit), total: matching.length };
  },
};
