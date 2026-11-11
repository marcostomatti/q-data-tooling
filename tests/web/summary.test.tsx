import type { CompanySummary, SummaryPage } from '../../src/web/api.ts';
import type { TokenName } from '@open-tomato/charts';
import type { ReactElement } from 'react';

import { echartsEngine, THEME_TOKENS, tokenName } from '@open-tomato/charts';
import { buildBarChartOption, tokensFrom } from '@open-tomato/charts/engine';
import { Badge, Button, ConfirmPopover, SectionCard } from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { createCompaniesClient, createSummaryClient, summaryPath } from '../../src/web/api.ts';
import { pageFor } from '../../src/web/app.tsx';
import { TRACKED_FORMS } from '../../src/web/components/filings-view.tsx';
import {
  AVERAGE_FILINGS_TITLE,
  FILINGS_CHART_LABEL,
  FILINGS_CHART_TITLE,
  filingsChartData,
  FORM_TONES,
  LATEST_FILING_TITLE,
  NO_LATEST_FILING,
  COMPANIES_LINK_LABEL,
  REMOVE_CONFIRM_LABEL,
  REMOVE_LABEL,
  removeMessage,
  COMPANIES_PATH,
  SUMMARY_EMPTY_DESCRIPTION,
  SUMMARY_EMPTY_TITLE,
  SUMMARY_PAGE_SIZE,
  SUMMARY_TITLE,
  SummaryChart,
  summaryColumns,
  SummaryPage as SummaryPageComponent,
  SummaryStatCards,
  summaryStats,
  SummaryTable,
  SummaryView,
  TOTAL_FILINGS_TITLE,
  withoutCompany,
} from '../../src/web/pages/summary.tsx';

import { settle } from './settle.tsx';

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

type Props = Record<string, unknown>;

function cellOf(key: string, company: CompanySummary, handlers: Parameters<typeof summaryColumns>[0] = {}): ReactElement<Props> {
  const column = summaryColumns(handlers).find((candidate) => candidate.key === key);
  if (column?.cell === undefined) throw new Error(`no cell for the ${key} column`);
  return column.cell(company) as ReactElement<Props>;
}

describe('the summary table', () => {
  test('has the ticker, the name, one column per tracked form and Remove last', () => {
    expect(summaryColumns().map((column) => column.key)).toEqual(['ticker', 'name', ...TRACKED_FORMS, 'remove']);
  });

  test('draws the ticker as a Badge', () => {
    const cell = cellOf('ticker', APPLE);
    expect(cell.type).toBe(Badge);
    expect(cell.props.children).toBe('AAPL');
  });

  test('draws the name as a ghost Button that opens the filings of its ticker', () => {
    const opened: string[] = [];
    const cell = cellOf('name', APPLE, { onOpenFilings: (ticker) => opened.push(ticker) });
    expect(cell.type).toBe(Button);
    expect(cell.props.variant).toBe('ghost');
    expect(cell.props.children).toBe('AAPL Inc.');
    (cell.props.onClick as () => void)();
    expect(opened).toEqual(['AAPL']);
  });

  test('counts each tracked form in its own column', () => {
    expect(TRACKED_FORMS.map((form) => cellOf(form, MICROSOFT) as unknown)).toEqual([1, 3, 11]);
  });

  test('puts Remove behind a ConfirmPopover, so only the confirm removes the company', () => {
    const removed: string[] = [];
    const cell = cellOf('remove', APPLE, { onRemove: (ticker) => removed.push(ticker) });
    expect(cell.type).toBe(ConfirmPopover);
    expect(cell.props.message).toBe(removeMessage('AAPL Inc.'));
    expect(cell.props.confirmLabel).toBe(REMOVE_CONFIRM_LABEL);
    const trigger = cell.props.children as ReactElement<Props>;
    expect(trigger.type).toBe(Button);
    expect(trigger.props.children).toBe(REMOVE_LABEL);
    expect(trigger.props.onClick).toBeUndefined();
    expect(removed).toEqual([]);
    (cell.props.onConfirm as () => void)();
    expect(removed).toEqual(['AAPL']);
  });

  test('renders one row per company with its ticker, name and counts', () => {
    const html = renderToStaticMarkup(<SummaryTable companies={[APPLE, MICROSOFT]} />);
    for (const text of ['AAPL', 'AAPL Inc.', 'MSFT', 'MSFT Inc.', '11', REMOVE_LABEL]) expect(html).toContain(text);
  });

  test('the view holds the table while the summary lists a company, and not otherwise', () => {
    const held = renderToStaticMarkup(<SummaryView result={pageOf([APPLE])} />);
    expect(held).toContain(REMOVE_LABEL);
    expect(held).toContain('AAPL Inc.');
    const empty = renderToStaticMarkup(<SummaryView result={pageOf([])} />);
    expect(empty).not.toContain(REMOVE_LABEL);
    expect(empty).toContain(SUMMARY_EMPTY_TITLE);
  });
});

describe('withoutCompany', () => {
  test('takes the company out and the total down by one', () => {
    const next = withoutCompany(pageOf([APPLE, MICROSOFT]), 'AAPL');
    expect(next.items.map((company) => company.ticker)).toEqual(['MSFT']);
    expect(next.total).toBe(1);
  });

  test('a ticker the summary does not hold leaves the same object', () => {
    const page = pageOf([APPLE]);
    expect(withoutCompany(page, 'MSFT')).toBe(page);
  });
});

describe('the summary chart', () => {
  test('has one category per company and one series per tracked form, counted per company', () => {
    const { categories, series } = filingsChartData([APPLE, MICROSOFT]);
    expect(categories).toEqual(['AAPL', 'MSFT']);
    expect(series.map((entry) => entry.id)).toEqual([...TRACKED_FORMS]);
    expect(series.map((entry) => entry.tone)).toEqual(TRACKED_FORMS.map((form) => FORM_TONES[form]));
    expect(series.map((entry) => entry.values)).toEqual([[1, 1], [3, 3], [8, 11]]);
  });

  test('gives each form its own tone', () => {
    expect(new Set(Object.values(FORM_TONES)).size).toBe(TRACKED_FORMS.length);
  });

  test('draws the stacked BarChart inside a SectionCard', () => {
    const card = SummaryChart({ companies: [APPLE] }) as ReactElement<{ title: string, children: ReactElement<Record<string, unknown>> }>;
    expect(card.type).toBe(SectionCard);
    expect(card.props.title).toBe(FILINGS_CHART_TITLE);
    const chart = card.props.children;
    expect(chart.type).toBe(echartsEngine.BarChart);
    expect(chart.props.mode).toBe('stacked');
    expect(chart.props.ariaLabel).toBe(FILINGS_CHART_LABEL);
  });

  test('stacks every form on one stack in the option the engine draws, and grouped mode does not', () => {
    const data = filingsChartData([APPLE, MICROSOFT]);
    const values = Object.fromEntries(THEME_TOKENS.map((token) => [tokenName(token), '#000000'])) as Record<TokenName, string>;
    const tokens = tokensFrom(values);
    const stacksOf = (mode: 'grouped' | 'stacked'): unknown[] => {
      const option = buildBarChartOption({ ariaLabel: FILINGS_CHART_LABEL, ...data, mode }, tokens) as { series: { stack?: unknown }[] };
      return option.series.map((entry) => entry.stack);
    };
    const stacked = stacksOf('stacked');
    expect(stacked).toHaveLength(TRACKED_FORMS.length);
    expect(stacked[0]).toBeDefined();
    expect(new Set(stacked).size).toBe(1);
    expect(stacksOf('grouped').every((stack) => stack === undefined)).toBe(true);
  });

  test('the view holds the chart while the summary lists a company, and not otherwise', () => {
    const held = renderToStaticMarkup(<SummaryView result={pageOf([APPLE])} />);
    expect(held).toContain(FILINGS_CHART_TITLE);
    expect(held).toContain(`aria-label="${FILINGS_CHART_LABEL}"`);
    const empty = renderToStaticMarkup(<SummaryView result={pageOf([])} />);
    expect(empty).not.toContain(FILINGS_CHART_TITLE);
  });
});

describe('the empty selection', () => {
  test('points to the Companies page with a link to /companies', () => {
    const html = renderToStaticMarkup(<SummaryView result={pageOf([])} />);
    expect(html).toContain(SUMMARY_EMPTY_TITLE);
    expect(html).toContain(`href="${COMPANIES_PATH}"`);
    expect(html).toContain(COMPANIES_LINK_LABEL);
  });

  test('shows no pointer while a company is selected', () => {
    const html = renderToStaticMarkup(<SummaryView result={pageOf([APPLE])} />);
    expect(html).not.toContain(COMPANIES_LINK_LABEL);
  });
});

describe('the summary page against a fetch stub', () => {
  function stubFetch(): { fetchImpl: typeof fetch, calls: string[] } {
    const calls: string[] = [];
    const fetchImpl = (async (path: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(path)} ${String(init?.body ?? '')}`.trim());
      return new Response(JSON.stringify({ success: true, data: init?.method === 'PATCH'
        ? { ticker: 'AAPL', selected: false }
        : pageOf([APPLE, MICROSOFT]) }));
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  test('lists the selected companies the summary answers', async () => {
    const { fetchImpl, calls } = stubFetch();
    const page = await settle(<SummaryPageComponent api={createSummaryClient(fetchImpl)} removeApi={createCompaniesClient(fetchImpl)} />);
    page.stop();
    expect(calls).toEqual([`GET ${summaryPath(1, SUMMARY_PAGE_SIZE)}`]);
    const html = renderToStaticMarkup(page.tree);
    for (const text of ['AAPL Inc.', 'MSFT Inc.', REMOVE_LABEL]) expect(html).toContain(text);
    expect(html.match(new RegExp(`>${REMOVE_LABEL}<`, 'g'))).toHaveLength(2);
  });

  test('Remove sends nothing until the popover confirms, then sends PATCH selected false and drops the row', async () => {
    const { fetchImpl, calls } = stubFetch();
    const page = await settle(<SummaryPageComponent api={createSummaryClient(fetchImpl)} removeApi={createCompaniesClient(fetchImpl)} />);
    const view = (page.tree.props.children as ReactElement<Record<string, unknown>>[])[0] as ReactElement<Record<string, unknown>>;
    const cell = summaryColumns({ onRemove: view.props.onRemove as (ticker: string) => void }).find((column) => column.key === 'remove')
      ?.cell?.(APPLE) as ReactElement<Record<string, unknown>>;
    expect(cell.type).toBe(ConfirmPopover);
    await page.flush();
    expect(calls.filter((call) => call.startsWith('PATCH'))).toEqual([]);

    (cell.props.onConfirm as () => void)();
    await page.flush();
    page.stop();
    expect(calls.filter((call) => call.startsWith('PATCH'))).toEqual(['PATCH /api/companies/AAPL {"selected":false}']);
    const html = renderToStaticMarkup(page.tree);
    expect(html).not.toContain('AAPL Inc.');
    expect(html).toContain('MSFT Inc.');
  });
});
