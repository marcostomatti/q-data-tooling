import type { Filing, FilingPage } from '../../src/web/api.ts';
import type { FilingsApi, FilingsResult } from '../../src/web/components/filings-view.tsx';
import type { ReactElement } from 'react';

import { Drawer, Modal } from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createFilingsClient, filingsPath } from '../../src/web/api.ts';
import {
  DEFAULT_LAYOUT,
  FILINGS_EMPTY_TITLE,
  FILINGS_LOADING,
  FILINGS_MAX_PAGES,
  FILINGS_PAGE_SIZE,
  FilingsLayoutToggle,
  FilingsPanel,
  FilingsView,
  LatestTenKCard,
  latestTenKOf,
  latestTitleOf,
  loadFilings,
} from '../../src/web/components/filings-view.tsx';

const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data/320193';

/** One filing of Apple's, its links built the way ingest builds them. */
function filingOf(form: string, filingDate: string, accession: string, acceptedAt = `${filingDate}T16:30:00.000Z`): Filing {
  const folder = `${ARCHIVES}/${accession.replaceAll('-', '')}`;
  const primaryDocument = `aapl-${filingDate.replaceAll('-', '')}.htm`;
  return {
    accessionNumber: accession,
    cik: 320193,
    form,
    baseForm: form.replace(/\/A$/, ''),
    isAmendment: form.endsWith('/A'),
    filingDate,
    reportDate: '2025-09-27',
    acceptedAt,
    act: '34',
    fileNumber: '001-36743',
    filmNumber: '251234567',
    items: [],
    sizeBytes: 1000,
    isXbrl: true,
    isInlineXbrl: true,
    primaryDocument,
    description: null,
    links: {
      document: `${folder}/${primaryDocument}`,
      index: `${folder}/${accession}-index.htm`,
      folderJson: `${folder}/index.json`,
      inlineXbrlViewer: `https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/${accession.replaceAll('-', '')}/${primaryDocument}`,
      rawXml: null,
    },
  };
}

const TEN_K = filingOf('10-K', '2025-10-31', '0000320193-25-000079');
const OLDER_TEN_K = filingOf('10-K', '2024-11-01', '0000320193-24-000123');
const TEN_Q = filingOf('10-Q', '2026-08-01', '0000320193-26-000073');
const EIGHT_K = filingOf('8-K', '2026-10-30', '0000320193-26-000080');

const COMPANY: FilingPage['company'] = {
  cik: 320193,
  cik10: '0000320193',
  ticker: 'AAPL',
  name: 'Apple Inc.',
  selected: true,
  exchanges: ['Nasdaq'],
  sic: '3571',
  sicDescription: 'Electronic Computers',
  category: 'Large accelerated filer',
  fiscalYearEnd: '0926',
  filingsSyncedAt: '2026-11-10T08:30:00.000Z',
};

const WITH_TEN_K: FilingsResult = { company: COMPANY, filings: [EIGHT_K, TEN_Q, TEN_K] };
const WITHOUT_TEN_K: FilingsResult = { company: COMPANY, filings: [EIGHT_K, TEN_Q] };

/** A stand-in for the server that pages `all` by the page and size asked, recording each call. */
function pagingApi(all: readonly Filing[], total = all.length) {
  const calls: { ticker: string, page: number, pageSize: number }[] = [];
  const api: FilingsApi = {
    list: async (ticker, page, pageSize) => {
      calls.push({ ticker, page, pageSize });
      const items = all.slice((page - 1) * pageSize, page * pageSize);
      return { company: COMPANY, filings: { items, page, pageSize, total } };
    },
  };
  return { api, calls };
}

describe('filingsPath and the filings client', () => {
  test('the path names the ticker, the page and the size', () => {
    expect(filingsPath('AAPL', 2, 100)).toBe('/api/companies/AAPL/filings?page=2&pageSize=100');
    expect(filingsPath('BRK/B', 1, 25)).toBe('/api/companies/BRK%2FB/filings?page=1&pageSize=25');
  });

  test('list sends a GET to the path and answers the envelope\'s data', async () => {
    const seen: { url: string, method: string | undefined }[] = [];
    const page: FilingPage = { company: COMPANY, filings: { items: [TEN_K], page: 1, pageSize: 100, total: 1 } };
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ success: true, data: page }));
    }) as typeof fetch;
    expect(await createFilingsClient(fake).list('AAPL', 1, 100)).toEqual(page);
    expect(seen).toEqual([{ url: '/api/companies/AAPL/filings?page=1&pageSize=100', method: 'GET' }]);
  });
});

describe('loadFilings', () => {
  test('one page is one call when it holds the total', async () => {
    const { api, calls } = pagingApi([EIGHT_K, TEN_Q, TEN_K]);
    const result = await loadFilings(api, 'AAPL');
    expect(result.filings).toEqual([EIGHT_K, TEN_Q, TEN_K]);
    expect(result.company).toEqual(COMPANY);
    expect(calls).toEqual([{ ticker: 'AAPL', page: 1, pageSize: FILINGS_PAGE_SIZE }]);
  });

  test('pages on until the filings reach the total, in order', async () => {
    const many = Array.from({ length: FILINGS_PAGE_SIZE + 5 }, (_, index) => ({ ...EIGHT_K, accessionNumber: `0000320193-26-${String(index).padStart(6, '0')}` }));
    const { api, calls } = pagingApi(many);
    const result = await loadFilings(api, 'AAPL');
    expect(result.filings).toEqual(many);
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });

  test('stops on an empty page when the total overcounts', async () => {
    const { api, calls } = pagingApi([TEN_K], 500);
    expect((await loadFilings(api, 'AAPL')).filings).toEqual([TEN_K]);
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });

  test('stops at the page cap when every page is full', async () => {
    const api: FilingsApi = {
      list: async (_ticker, page, pageSize) => ({
        company: COMPANY,
        filings: { items: Array.from({ length: pageSize }, () => TEN_Q), page, pageSize, total: Number.MAX_SAFE_INTEGER },
      }),
    };
    expect((await loadFilings(api, 'AAPL')).filings).toHaveLength(FILINGS_MAX_PAGES * FILINGS_PAGE_SIZE);
  });

  test('a refused page rejects the load', async () => {
    const api: FilingsApi = {
      list: async () => {
        throw new Error('no company trades under ZZZZ');
      },
    };
    await expect(loadFilings(api, 'ZZZZ')).rejects.toThrow('no company trades under ZZZZ');
  });
});

describe('latestTenKOf', () => {
  test('picks the 10-K with the latest filing date, whatever the order', () => {
    expect(latestTenKOf([OLDER_TEN_K, EIGHT_K, TEN_K, TEN_Q])).toBe(TEN_K);
    expect(latestTenKOf([TEN_K, OLDER_TEN_K])).toBe(TEN_K);
  });

  test('breaks a same-day tie by the acceptance time', () => {
    const later = filingOf('10-K/A', TEN_K.filingDate, '0000320193-25-000090', `${TEN_K.filingDate}T20:00:00.000Z`);
    expect(latestTenKOf([TEN_K, later])).toBe(later);
    expect(latestTenKOf([later, TEN_K])).toBe(later);
  });

  test('answers undefined when no 10-K is among the filings', () => {
    expect(latestTenKOf([EIGHT_K, TEN_Q])).toBeUndefined();
    expect(latestTenKOf([])).toBeUndefined();
  });

  test('the title reads Latest: 10-K and the filing date', () => {
    expect(latestTitleOf(TEN_K)).toBe('Latest: 10-K 2025-10-31');
  });
});

describe('LatestTenKCard', () => {
  test('shows the title and the primary document', () => {
    const html = renderToStaticMarkup(<LatestTenKCard filing={TEN_K} onOpenLink={() => undefined} />);
    expect(html).toContain('Latest: 10-K 2025-10-31');
    expect(html).toContain(TEN_K.primaryDocument);
    expect(html).toContain('2025-09-27');
  });

  test('opening the card opens the filing\'s document link', () => {
    const opened: string[] = [];
    const card = LatestTenKCard({ filing: TEN_K, onOpenLink: (url) => opened.push(url) }) as ReactElement<{ onOpen: () => void }>;
    card.props.onOpen();
    expect(opened).toEqual([`${ARCHIVES}/000032019325000079/aapl-20251031.htm`]);
  });
});

describe('FilingsPanel', () => {
  test('shows the latest card when the company filed a 10-K', () => {
    const html = renderToStaticMarkup(<FilingsPanel layout="drawer" result={WITH_TEN_K} />);
    expect(html).toContain('Latest: 10-K 2025-10-31');
  });

  test('shows no latest card when the company filed no 10-K', () => {
    const html = renderToStaticMarkup(<FilingsPanel layout="drawer" result={WITHOUT_TEN_K} />);
    expect(html).not.toContain('Latest:');
    expect(html).not.toContain(FILINGS_EMPTY_TITLE);
  });

  test('says it is loading before the answer, and shows no card', () => {
    const html = renderToStaticMarkup(<FilingsPanel layout="drawer" />);
    expect(html).toContain(FILINGS_LOADING);
    expect(html).not.toContain('Latest:');
  });

  test('an error shows an alert instead of the loading line', () => {
    const html = renderToStaticMarkup(<FilingsPanel layout="drawer" error="no company trades under ZZZZ" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('no company trades under ZZZZ');
    expect(html).not.toContain(FILINGS_LOADING);
  });

  test('a company with no filings shows the empty state', () => {
    const html = renderToStaticMarkup(<FilingsPanel layout="drawer" result={{ company: COMPANY, filings: [] }} />);
    expect(html).toContain(FILINGS_EMPTY_TITLE);
  });
});

describe('FilingsLayoutToggle', () => {
  test('marks the layout shown as the selected option', () => {
    const drawer = renderToStaticMarkup(<FilingsLayoutToggle layout="drawer" />);
    expect(drawer).toMatch(/aria-selected="true"[^>]*>Drawer</);
    expect(drawer).toMatch(/aria-selected="false"[^>]*>Full screen</);
    const modal = renderToStaticMarkup(<FilingsLayoutToggle layout="modal" />);
    expect(modal).toMatch(/aria-selected="true"[^>]*>Full screen</);
  });

  test('a pick hands the layout of the option picked', () => {
    const picked: string[] = [];
    const toggle = FilingsLayoutToggle({ layout: 'drawer', onLayoutChange: (layout) => picked.push(layout) }) as ReactElement<{ onChange: (index: number) => void }>;
    toggle.props.onChange(1);
    toggle.props.onChange(0);
    toggle.props.onChange(7);
    expect(picked).toEqual(['modal', 'drawer']);
  });
});

describe('FilingsView', () => {
  /** The props the view hands its overlay, read without a DOM by calling the view. */
  type OverlayElement = ReactElement<{ open: boolean, title: string, eyebrow: string, size?: string, className?: string, onClose: () => void }>;
  const viewOf = (layout: 'drawer' | 'modal', result?: FilingsResult) => FilingsView({ ticker: 'AAPL', open: true, onClose: () => undefined, layout, result }) as OverlayElement;

  test('opens on the drawer', () => {
    expect(DEFAULT_LAYOUT).toBe('drawer');
  });

  test('the drawer layout is the library\'s Drawer at its large size', () => {
    const view = viewOf('drawer', WITH_TEN_K);
    expect(view.type).toBe(Drawer);
    expect(view.props.size).toBe('lg');
    expect(view.props.open).toBe(true);
  });

  test('the modal layout is the library\'s Modal, stretched over the screen', () => {
    const view = viewOf('modal', WITH_TEN_K);
    expect(view.type).toBe(Modal);
    expect(view.props.className).toContain('w-screen');
    expect(view.props.className).toContain('h-dvh');
  });

  test('titles the overlay with the company name, the ticker before it arrives', () => {
    expect(viewOf('drawer', WITH_TEN_K).props.title).toBe('Apple Inc.');
    expect(viewOf('drawer').props.title).toBe('AAPL');
    expect(viewOf('modal').props.eyebrow).toBe('AAPL');
  });

  test('both layouts hold the same panel, with the latest card', () => {
    for (const layout of ['drawer', 'modal'] as const) {
      const panel = viewOf(layout, WITH_TEN_K).props as unknown as { children: ReactElement };
      const html = renderToStaticMarkup(panel.children);
      expect(html).toContain('Latest: 10-K 2025-10-31');
      expect(html).toContain('role="tablist"');
    }
  });
});
