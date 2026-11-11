import type { CompanySummary, SummaryPage } from '../../src/web/api.ts';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { createSummaryClient, summaryPath } from '../../src/web/api.ts';
import { pageFor } from '../../src/web/app.tsx';
import {
  AVERAGE_FILINGS_TITLE,
  LATEST_FILING_TITLE,
  NO_LATEST_FILING,
  SUMMARY_EMPTY_DESCRIPTION,
  SUMMARY_EMPTY_TITLE,
  SUMMARY_PAGE_SIZE,
  SUMMARY_TITLE,
  SummaryStatCards,
  summaryStats,
  SummaryView,
  TOTAL_FILINGS_TITLE,
} from '../../src/web/pages/summary.tsx';

const LINKS = {
  document: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm',
  index: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/',
  folderJson: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/index.json',
  inlineXbrlViewer: null,
  rawXml: null,
};

function companyOf(ticker: string, total: number, latest10K: string | null): CompanySummary {
  return {
    cik: ticker.length,
    ticker,
    name: `${ticker} Inc.`,
    counts: { '10-K': 1, '10-Q': 3, '8-K': total - 4, total },
    latest10K: latest10K === null
      ? null
      : { filingDate: latest10K, links: LINKS },
    filingsSyncedAt: '2025-11-01T00:00:00.000Z',
  };
}

const APPLE = companyOf('AAPL', 12, '2025-10-31');
const MICROSOFT = companyOf('MSFT', 15, '2025-07-30');
const NO_10K = companyOf('NEW', 4, null);

function pageOf(items: CompanySummary[]): SummaryPage {
  return { items, page: 1, pageSize: SUMMARY_PAGE_SIZE, total: items.length };
}

describe('the summary page', () => {
  test('renders its title and its empty state', () => {
    const html = renderToStaticMarkup(<SummaryView />);
    expect(html).toContain(SUMMARY_TITLE);
    expect(html).toContain(SUMMARY_EMPTY_TITLE);
    expect(html).toContain(SUMMARY_EMPTY_DESCRIPTION);
  });

  test('the nav finds /summary', () => {
    expect(pageFor('/summary').path).toBe('/summary');
  });
});

describe('summaryStats', () => {
  test('sums the totals, averages them per company and keeps the latest 10-K', () => {
    expect(summaryStats([MICROSOFT, NO_10K, APPLE])).toEqual({
      totalFilings: 31,
      averagePerCompany: 10.3,
      latest: { ticker: 'AAPL', filingDate: '2025-10-31' },
    });
  });

  test('an empty selection has no filings, an average of 0 and no latest', () => {
    expect(summaryStats([])).toEqual({ totalFilings: 0, averagePerCompany: 0, latest: undefined });
  });

  test('companies with no 10-K leave no latest', () => {
    expect(summaryStats([NO_10K]).latest).toBeUndefined();
  });

  test('a tie keeps the company listed first', () => {
    const twin = companyOf('TWIN', 5, APPLE.latest10K?.filingDate ?? null);
    expect(summaryStats([APPLE, twin]).latest?.ticker).toBe('AAPL');
  });
});

describe('the stat cards', () => {
  test('show the three figures under their titles', () => {
    const html = renderToStaticMarkup(<SummaryStatCards stats={summaryStats([APPLE, MICROSOFT])} />);
    expect(html).toContain(TOTAL_FILINGS_TITLE);
    expect(html).toContain(AVERAGE_FILINGS_TITLE);
    expect(html).toContain(LATEST_FILING_TITLE);
    expect(html).toContain('27');
    expect(html).toContain('13.5');
    expect(html).toContain('2025-10-31');
    expect(html).toContain('AAPL');
  });

  test('show the dash when no company filed a 10-K', () => {
    const html = renderToStaticMarkup(<SummaryStatCards stats={summaryStats([NO_10K])} />);
    expect(html).toContain(NO_LATEST_FILING);
  });

  test('the view holds the cards once a summary is held, and not before', () => {
    const held = renderToStaticMarkup(<SummaryView result={pageOf([APPLE])} />);
    expect(held).toContain(TOTAL_FILINGS_TITLE);
    expect(held).not.toContain(SUMMARY_EMPTY_TITLE);
    const before = renderToStaticMarkup(<SummaryView />);
    expect(before).not.toContain(TOTAL_FILINGS_TITLE);
  });

  test('the view shows a failed fetch in an alert', () => {
    const html = renderToStaticMarkup(<SummaryView error="the server answered 500" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('the server answered 500');
  });
});

describe('the summary client', () => {
  test('asks GET /api/filings/summary for one page', async () => {
    const calls: { url: string, method: string | undefined }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return Response.json({ success: true, data: pageOf([APPLE]) });
    }) as typeof fetch;
    const answer = await createSummaryClient(fetchImpl).list(1, SUMMARY_PAGE_SIZE);
    expect(calls).toEqual([{ url: summaryPath(1, SUMMARY_PAGE_SIZE), method: 'GET' }]);
    expect(summaryPath(1, SUMMARY_PAGE_SIZE)).toBe('/api/filings/summary?page=1&pageSize=100');
    expect(answer.items[0]?.ticker).toBe('AAPL');
  });
});
