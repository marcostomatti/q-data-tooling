import type { Company } from '../../entities/company.ts';

/**
 * The fixed companies the filings stub stores in `src/routes/filings/stub.ts` answer with until
 * the filings flows are wired to the repositories. The companies flows read the companies
 * repository through `companyStore` in `repository.ts`, not these. Their header fields are
 * public SEC facts; the fields a sync fills stay empty, as they do for a company never synced.
 */
export const STUB_COMPANIES: readonly Company[] = [
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
