import type { Filing, FilingPage } from '../../src/web/api.ts';
import type { FilingsApi, FilingsResult } from '../../src/web/components/filings/logic.ts';
import type { ReactElement } from 'react';

import { Drawer, Entity, Modal } from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TrackedForm } from '../../src/entities/filing.ts';
import { buildLinks } from '../../src/sec/parse.ts';
import { createFilingsClient, filingsPath } from '../../src/web/api.ts';
import {
  FilingsAccordion,
} from '../../src/web/components/filings/accordion.tsx';
import {
  FilingRow,
} from '../../src/web/components/filings/filing-row.tsx';
import {
  FilingsGrid,
} from '../../src/web/components/filings/grid.tsx';
import {
  LatestTenKCard,
} from '../../src/web/components/filings/latest-card.tsx';
import {
  DEFAULT_LAYOUT,
  DOCUMENT_LINK_LABEL,
  FILINGS_EMPTY_TITLE,
  FILINGS_LOADING,
  FILINGS_MAX_PAGES,
  FILINGS_PAGE_SIZE,
  filingCountOf,
  groupByForm,
  IX_VIEWER_LABEL,
  latestTenKOf,
  latestTitleOf,
  loadFilings,
  noFilingsOf,
  TRACKED_FORMS,
} from '../../src/web/components/filings/logic.ts';
import {
  FilingsLayoutToggle,
  FilingsPanel,
} from '../../src/web/components/filings/panel.tsx';
import {
  FilingsView,
} from '../../src/web/components/filings/view.tsx';

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

describe('groupByForm', () => {
  test('the view\'s forms are the tracked forms, in their order', () => {
    expect(TRACKED_FORMS).toEqual(TrackedForm.options);
  });

  test('one group per tracked form, amendments under their form, order kept', () => {
    const amended = filingOf('10-K/A', '2025-12-01', '0000320193-25-000099');
    const groups = groupByForm([EIGHT_K, amended, TEN_Q, TEN_K]);
    expect(groups.map((group) => group.form)).toEqual(['10-K', '10-Q', '8-K']);
    expect(groups[0]?.filings).toEqual([amended, TEN_K]);
    expect(groups[1]?.filings).toEqual([TEN_Q]);
    expect(groups[2]?.filings).toEqual([EIGHT_K]);
  });

  test('a form not filed is an empty group, an untracked form is left out', () => {
    const groups = groupByForm([filingOf('S-1', '2026-01-02', '0000320193-26-000001'), TEN_Q]);
    expect(groups.map((group) => group.filings.length)).toEqual([0, 1, 0]);
  });
});

describe('FilingRow', () => {
  test('names the primary document, links it to links.document, and dates it on the line below', () => {
    const html = renderToStaticMarkup(<FilingRow filing={TEN_K} />);
    expect(html).toContain(`href="${ARCHIVES}/000032019325000079/aapl-20251031.htm"`);
    expect(html).toContain(`>${DOCUMENT_LINK_LABEL}</a>`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html.indexOf(TEN_K.primaryDocument)).toBeGreaterThan(-1);
    expect(html.indexOf('2025-10-31')).toBeGreaterThan(html.indexOf(TEN_K.primaryDocument));
  });

  test('is the library\'s Entity stack, with no class string passed', () => {
    const row = FilingRow({ filing: TEN_K });
    expect(row.type).toBe(Entity);
    expect(row.props.layout).toBe('stack');
    expect(row.props.className).toBeUndefined();
  });

  test('adds the ix viewer link when the filing has one', () => {
    const html = renderToStaticMarkup(<FilingRow filing={TEN_K} />);
    expect(html).toContain('href="https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019325000079/aapl-20251031.htm"');
    expect(html).toContain(`>${IX_VIEWER_LABEL}</a>`);
  });

  test('shows no ix viewer link without inline XBRL', () => {
    const plain: typeof TEN_K = { ...TEN_K, isInlineXbrl: false, links: { ...TEN_K.links, inlineXbrlViewer: null } };
    const html = renderToStaticMarkup(<FilingRow filing={plain} />);
    expect(html).not.toContain(IX_VIEWER_LABEL);
    expect(html).not.toContain('/ix?doc=');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  test('names the form as filed for an amendment only', () => {
    const amended = filingOf('10-K/A', '2025-12-01', '0000320193-25-000099');
    expect(renderToStaticMarkup(<FilingRow filing={amended} />)).toContain('10-K/A');
    expect(renderToStaticMarkup(<FilingRow filing={TEN_K} />)).not.toContain('10-K');
  });
});

describe('FilingsAccordion', () => {
  test('titles one group per tracked form with its count', () => {
    const html = renderToStaticMarkup(<FilingsAccordion filings={[EIGHT_K, TEN_Q, TEN_K, OLDER_TEN_K]} />);
    expect(html).toContain('10-K (2)');
    expect(html).toContain('10-Q (1)');
    expect(html).toContain('8-K (1)');
  });

  test('opens the first form\'s group by default, its filings linked', () => {
    const html = renderToStaticMarkup(<FilingsAccordion filings={WITH_TEN_K.filings} />);
    expect(html).toContain(`href="${TEN_K.links.document}"`);
    expect(html).not.toContain(`href="${TEN_Q.links.document}"`);
  });

  test('open groups list every filing, and an empty form says so', () => {
    const html = renderToStaticMarkup(<FilingsAccordion filings={WITHOUT_TEN_K.filings} defaultOpen={TRACKED_FORMS} />);
    expect(html).toContain(noFilingsOf('10-K'));
    expect(html).toContain(`href="${TEN_Q.links.document}"`);
    expect(html).toContain(`href="${EIGHT_K.links.document}"`);
  });

  test('the drawer panel holds the accordion, the modal panel does not', () => {
    expect(renderToStaticMarkup(<FilingsPanel layout="drawer" result={WITH_TEN_K} />)).toContain('10-Q (1)');
    expect(renderToStaticMarkup(<FilingsPanel layout="modal" result={WITH_TEN_K} />)).not.toContain('10-Q (1)');
  });

  test('the drawer panel shows no accordion before the answer or with no filings', () => {
    expect(renderToStaticMarkup(<FilingsPanel layout="drawer" />)).not.toContain('10-Q (');
    expect(renderToStaticMarkup(<FilingsPanel layout="drawer" result={{ company: COMPANY, filings: [] }} />)).not.toContain('10-Q (');
  });
});

describe('FilingsGrid', () => {
  test('is a 3-column grid with one SectionCard per tracked form, counted', () => {
    const html = renderToStaticMarkup(<FilingsGrid filings={[EIGHT_K, TEN_Q, TEN_K, OLDER_TEN_K]} />);
    expect(html).toContain('grid-cols-3');
    expect(html.match(/<section/g)?.length).toBe(TRACKED_FORMS.length);
    expect(html).toContain(filingCountOf(2));
    expect(html.indexOf('>10-K<')).toBeLessThan(html.indexOf('>10-Q<'));
    expect(html.indexOf('>10-Q<')).toBeLessThan(html.indexOf('>8-K<'));
  });

  test('every card lists its filings at once, with the document and ix viewer links', () => {
    const html = renderToStaticMarkup(<FilingsGrid filings={WITH_TEN_K.filings} />);
    for (const filing of WITH_TEN_K.filings) {
      expect(html).toContain(`href="${filing.links.document}"`);
      expect(html).toContain(`href="${(filing.links.inlineXbrlViewer ?? '').replaceAll('&', '&amp;')}"`);
    }
  });

  test('a form not filed says so in its card', () => {
    const html = renderToStaticMarkup(<FilingsGrid filings={WITHOUT_TEN_K.filings} />);
    expect(html).toContain(noFilingsOf('10-K'));
    expect(html).not.toContain(noFilingsOf('10-Q'));
  });

  test('the count reads singular for one filing and plural otherwise', () => {
    expect(filingCountOf(0)).toBe('0 filings');
    expect(filingCountOf(1)).toBe('1 filing');
    expect(filingCountOf(4)).toBe('4 filings');
  });

  test('the modal panel holds the grid, the drawer panel does not', () => {
    expect(renderToStaticMarkup(<FilingsPanel layout="modal" result={WITH_TEN_K} />)).toContain('grid-cols-3');
    expect(renderToStaticMarkup(<FilingsPanel layout="drawer" result={WITH_TEN_K} />)).not.toContain('grid-cols-3');
  });

  test('the modal panel shows no grid before the answer or with no filings', () => {
    expect(renderToStaticMarkup(<FilingsPanel layout="modal" />)).not.toContain('grid-cols-3');
    expect(renderToStaticMarkup(<FilingsPanel layout="modal" result={{ company: COMPANY, filings: [] }} />)).not.toContain('grid-cols-3');
  });
});

describe('the filings panel as a whole, in both layouts', () => {
  const LAYOUTS = ['drawer', 'modal'] as const;
  const BUILT = buildLinks(320193, TEN_K.accessionNumber, TEN_K.primaryDocument, true);
  const BUILT_TEN_K: Filing = { ...TEN_K, links: BUILT };
  const amp = (url: string) => url.replaceAll('&', '&amp;');

  test.each(LAYOUTS)('%s: a company with no 10-K shows no latest card, yet all three groups', (layout) => {
    const html = renderToStaticMarkup(<FilingsPanel layout={layout} result={WITHOUT_TEN_K} />);
    expect(html).not.toContain('Latest:');
    expect(html).toContain(noFilingsOf('10-K'));
  });

  test.each(LAYOUTS)('%s: the groups are the three tracked forms, in order', (layout) => {
    const html = renderToStaticMarkup(<FilingsPanel layout={layout} result={WITH_TEN_K} />);
    const at = TRACKED_FORMS.map((form) => html.indexOf(layout === 'drawer'
      ? `${form} (`
      : `>${form}<`));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(TRACKED_FORMS).toEqual(['10-K', '10-Q', '8-K']);
  });

  test.each(LAYOUTS)('%s: the links carry the sec.gov URLs ingest builds', (layout) => {
    const html = renderToStaticMarkup(<FilingsPanel layout={layout} result={{ company: COMPANY, filings: [BUILT_TEN_K] }} />);
    expect(BUILT.document.startsWith('https://www.sec.gov/Archives/edgar/data/320193/')).toBe(true);
    expect(html).toContain(`href="${amp(BUILT.document)}"`);
    expect(html).toContain(`href="${amp(BUILT.inlineXbrlViewer ?? '')}"`);
    expect(BUILT.inlineXbrlViewer?.startsWith('https://www.sec.gov/ix?doc=')).toBe(true);
  });

  test('the latest card opens the built document URL', () => {
    const opened: string[] = [];
    const card = LatestTenKCard({ filing: BUILT_TEN_K, onOpenLink: (url) => opened.push(url) }) as ReactElement<{ onOpen: () => void }>;
    card.props.onOpen();
    expect(opened).toEqual([BUILT.document]);
  });
});
