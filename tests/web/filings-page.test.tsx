import type { Company, Filing, FilingPage } from '../../src/web/api.ts';
import type { FilingsResult } from '../../src/web/components/filings/logic.ts';
import type { FilingsPageApi } from '../../src/web/pages/filings/logic.ts';
import type { Column } from '@open-tomato/components';
import type { ReactElement } from 'react';

import { Badge, Button, EmptyState, Icon, Segmented, Table, Toolbar } from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { pageFor } from '../../src/web/app.tsx';
import { FILINGS_EMPTY_TITLE, FILINGS_PAGE_SIZE } from '../../src/web/components/filings/logic.ts';
import { CompanyRow } from '../../src/web/pages/companies/row.tsx';
import { FilingsPage } from '../../src/web/pages/filings/index.tsx';
import {
  cikFromPath,
  FILINGS_PATH,
  FILINGS_TABLE_HEIGHT,
  FILINGS_TITLE,
  filingsPathOf,
  FORM_FILTERS,
  missingTitleOf,
  NOTHING_DESCRIPTION,
  NOTHING_TITLE,
  SEARCH_LABEL,
} from '../../src/web/pages/filings/logic.ts';
import { filingColumns, NEWEST_FIRST } from '../../src/web/pages/filings/table.tsx';
import { FilingsControls, type FilingsControlsProps } from '../../src/web/pages/filings/toolbar.tsx';
import { FilingsView, type FilingsViewProps } from '../../src/web/pages/filings/view.tsx';

import { settle } from './settle.tsx';
import { findElement, type AnyElement } from './tree.ts';

const APPLE: Company = {
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

/** One filing of Apple's, with sec.gov links built from its accession number. */
function filingOf(form: string, filingDate: string, accession: string, primaryDocument: string): Filing {
  const folder = `https://www.sec.gov/Archives/edgar/data/320193/${accession.replaceAll('-', '')}`;
  return {
    accessionNumber: accession,
    cik: 320193,
    form,
    baseForm: form.replace(/\/A$/, ''),
    isAmendment: form.endsWith('/A'),
    filingDate,
    reportDate: filingDate,
    acceptedAt: `${filingDate}T16:30:00.000Z`,
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

const TEN_K = filingOf('10-K', '2026-11-03', '0000320193-26-000026', 'aapl-20260926.htm');
const EIGHT_K_A = filingOf('8-K/A', '2026-09-01', '0001140361-26-035325', 'ef20081427_8ka.htm');

const FORM_FOUR = filingOf('4', '2026-08-20', '0001140361-26-031111', 'xslF345X06/form4.xml');
const SCHEDULE = filingOf('SCHEDULE 13G', '2026-02-14', '0001104659-26-016161', 'tm265123d1_sc13g.htm');

/** Apple's year as the view holds it, newest first. */
const YEAR: FilingsResult = { company: APPLE, filings: [TEN_K, EIGHT_K_A, FORM_FOUR, SCHEDULE] };

/** A page of Apple's filings as the server answers it. */
function pageOf(items: readonly Filing[], total = items.length, page = 1): FilingPage {
  return { company: APPLE, filings: { items: [...items], total, page, pageSize: FILINGS_PAGE_SIZE } };
}

/** One call the page made, as a stub records it. */
type Call = readonly [string, ...unknown[]];

/** A stand-in for the server: finds Apple by its CIK, answers `answer` for every page, and records each call. */
function stubApi(answer: FilingPage = pageOf(YEAR.filings)): { api: FilingsPageApi, calls: Call[] } {
  const calls: Call[] = [];
  const api: FilingsPageApi = {
    findCompany: async (cik) => {
      calls.push(['findCompany', cik]);
      return cik === APPLE.cik
        ? APPLE
        : undefined;
    },
    list: async (ticker, page, pageSize) => {
      calls.push(['list', ticker, page, pageSize]);
      return answer;
    },
    select: async (ticker, selected) => {
      calls.push(['select', ticker, selected]);
      return { ...APPLE, selected };
    },
  };
  return { api, calls };
}

/** The view's props for Apple's year, every form shown, every handler unset. */
function viewProps(overrides: Partial<FilingsViewProps> = {}): FilingsViewProps {
  return { cik: APPLE.cik, result: YEAR, form: undefined, ...overrides };
}

function find(props: FilingsViewProps, match: (element: AnyElement) => boolean): AnyElement | undefined {
  return findElement(FilingsView(props), match);
}

/** The accession numbers of the rows the view's table holds. */
function shownAccessions(props: FilingsViewProps): readonly string[] {
  const table = find(props, (element) => element.type === Table);
  return (table?.props.data as Filing[] | undefined ?? []).map((filing) => filing.accessionNumber);
}

/** The form filter's `Segmented`, read from the controls row the view draws. */
function filterOf(props: FilingsViewProps): AnyElement | undefined {
  const controls = find(props, (element) => element.type === FilingsControls);
  return findElement(FilingsControls(controls?.props as unknown as FilingsControlsProps), (element) => element.type === Segmented);
}

/** The column with the key, or a loud failure. */
function columnOf(key: string): Column<Filing> {
  const column = filingColumns().find((each) => each.key === key);
  if (column === undefined) throw new Error(`no column ${key}`);
  return column;
}

describe('the filings page path', () => {
  test('reads a CIK from /filings/<cik>, leading zeros or not', () => {
    expect(cikFromPath('/filings/320193')).toBe(320193);
    expect(cikFromPath('/filings/0000320193')).toBe(320193);
  });

  test('reads no CIK from /filings, a blank segment, a ticker or a deeper path', () => {
    expect(cikFromPath('/filings')).toBeUndefined();
    expect(cikFromPath('/filings/')).toBeUndefined();
    expect(cikFromPath('/filings/AAPL')).toBeUndefined();
    expect(cikFromPath('/filings/320193/x')).toBeUndefined();
  });

  test('builds the path of a company from its CIK', () => {
    expect(filingsPathOf(320193)).toBe('/filings/320193');
  });

  test('pageFor finds the Filings page for /filings and for /filings/<cik>, and no other prefix', () => {
    expect(pageFor(FILINGS_PATH).label).toBe(FILINGS_TITLE);
    expect(pageFor('/filings/320193').path).toBe(FILINGS_PATH);
    expect(pageFor('/filingsx').path).not.toBe(FILINGS_PATH);
  });
});

describe('FilingsView', () => {
  test('with no company, shows the landmark empty state that points to the search', () => {
    const empty = find({ form: undefined }, (element) => element.type === EmptyState);
    expect(empty?.props.title).toBe(NOTHING_TITLE);
    expect(empty?.props.description).toBe(NOTHING_DESCRIPTION);
    expect((empty?.props.illustration as AnyElement).type).toBe(Icon);
    expect((empty?.props.illustration as AnyElement).props.name).toBe('landmark');
    expect(NOTHING_TITLE).toBe('Nothing to show');
    expect(NOTHING_DESCRIPTION).toBe('Search for a company by CIK, ticker or name to see their filings.');
  });

  test('the empty state\'s Search button calls onSearch, with or without a CIK that matched', () => {
    let searched = 0;
    for (const props of [{ form: undefined }, viewProps({ cik: 42, result: undefined, missing: true })]) {
      const empty = find({ ...props, onSearch: () => (searched += 1) }, (element) => element.type === EmptyState);
      const button = empty?.props.action as AnyElement;
      expect(button.type).toBe(Button);
      expect(button.props.children).toBe(SEARCH_LABEL);
      (button.props.onClick as () => void)();
    }
    expect(searched).toBe(2);
    expect(SEARCH_LABEL).toBe('Search');
  });

  test('with a CIK no company has, names the CIK in the empty state', () => {
    const empty = find(viewProps({ cik: 42, result: undefined, missing: true }), (element) => element.type === EmptyState);
    expect(empty?.props.title).toBe(missingTitleOf(42));
    expect(missingTitleOf(42)).toBe('No company has the CIK 42');
  });

  test('heads the page with the company card, its name as text since the page already shows its filings', () => {
    const card = find(viewProps(), (element) => element.type === CompanyRow);
    expect(card?.props.company).toEqual(APPLE);
    expect(card?.props.onOpenFilings).toBeUndefined();
  });

  test('draws the year as one scrolling Table attached to the toolbar, newest first', () => {
    const toolbar = find(viewProps(), (element) => element.type === Toolbar);
    const table = findElement(toolbar, (element) => element.type === Table);
    expect(table?.props.frame).toBe(false);
    expect(table?.props.layout).toBe('scroll');
    expect(table?.props.maxHeight).toBe(FILINGS_TABLE_HEIGHT);
    expect(FILINGS_TABLE_HEIGHT).toBe(640);
    expect(table?.props.initialSort).toEqual(NEWEST_FIRST);
    expect(NEWEST_FIRST).toEqual({ key: 'filed', dir: 'desc' });
    expect(shownAccessions(viewProps())).toEqual(YEAR.filings.map((filing) => filing.accessionNumber));
  });

  test('the table sits in a box carrying the page\'s ref, and its body takes the height the page measured', () => {
    const tableRef = (): void => {};
    const toolbar = find(viewProps({ tableHeight: 812, tableRef }), (element) => element.type === Toolbar);
    const box = findElement(toolbar, (element) => element.type === 'div' && element.props.ref === tableRef);
    const table = findElement(box, (element) => element.type === Table);
    expect(table?.props.maxHeight).toBe(812);
  });

  test('a row reads date, then the document, then the form, then the links', () => {
    expect(filingColumns().map((column) => column.key)).toEqual(['filed', 'document', 'form', 'links']);
    const html = renderToStaticMarkup(<FilingsView {...viewProps({ result: { company: APPLE, filings: [TEN_K] } })} />);
    expect(html).toMatch(/2026-11-03.*aapl-20260926\.htm.*0000320193-26-000026.*>10-K<.*href="https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/320193\/000032019326000026\/aapl-20260926\.htm"/);
  });

  test('the Filed and Form headers sort, and the document and the links do not', () => {
    expect(filingColumns().filter((column) => column.sortable === true)
      .map((column) => column.key)).toEqual(['filed', 'form']);
  });

  test('Filed sorts by the filing date, then by the acceptance time within one day', () => {
    const morning = { ...TEN_K, acceptedAt: '2026-11-03T09:00:00.000Z' };
    const evening = { ...TEN_K, acceptedAt: '2026-11-03T21:00:00.000Z' };
    const by = columnOf('filed').sortAccessor;
    expect(String(by?.(morning)) < String(by?.(evening))).toBe(true);
    expect(String(by?.(EIGHT_K_A)) < String(by?.(morning))).toBe(true);
  });

  test('Form sorts by the form as filed, so an amendment sits beside its form', () => {
    expect(columnOf('form').sortAccessor?.(EIGHT_K_A)).toBe('8-K/A');
  });

  test('an amendment shows its form as filed in a warning badge', () => {
    const badge = columnOf('form').cell?.(EIGHT_K_A) as AnyElement;
    expect(badge.type).toBe(Badge);
    expect(badge.props.tone).toBe('warning');
    expect(badge.props.children).toBe('8-K/A');
    expect((columnOf('form').cell?.(TEN_K) as AnyElement).props.tone).toBe('neutral');
  });

  test('the form filter offers every form, the six named ones and Other, and reports the one picked', () => {
    expect(FORM_FILTERS.map((item) => item.label)).toEqual(['All', '10-K', '10-Q', '8-K', '6-K', 'Form 4', 'Form 144', 'Other']);
    const picked: (string | undefined)[] = [];
    const filter = filterOf(viewProps({ form: '10-Q', onFormChange: (form) => picked.push(form) }));
    expect(filter?.props.index).toBe(2);
    (filter?.props.onChange as (index: number) => void)(5);
    (filter?.props.onChange as (index: number) => void)(7);
    (filter?.props.onChange as (index: number) => void)(0);
    expect(picked).toEqual(['4', 'other', undefined]);
  });

  test('a form picked keeps its filings only, amendments under their form and every unnamed form under Other', () => {
    expect(shownAccessions(viewProps({ form: '8-K' }))).toEqual([EIGHT_K_A.accessionNumber]);
    expect(shownAccessions(viewProps({ form: '4' }))).toEqual([FORM_FOUR.accessionNumber]);
    expect(shownAccessions(viewProps({ form: 'other' }))).toEqual([SCHEDULE.accessionNumber]);
  });

  test('counts the filings shown', () => {
    expect(renderToStaticMarkup(<FilingsView {...viewProps()} />)).toContain('4 filings');
    expect(renderToStaticMarkup(<FilingsView {...viewProps({ form: '4' })} />)).toContain('1 filing');
  });

  test('with no filings of the form picked, says so in the toolbar in place of the table', () => {
    const props = viewProps({ form: '10-Q' });
    expect(find(props, (element) => element.type === Table)).toBeUndefined();
    expect(find(props, (element) => element.type === EmptyState)?.props.title).toBe('No 10-Q filings in the last year');
    expect(find(viewProps({ form: '144' }), (element) => element.type === EmptyState)?.props.title).toBe('No Form 144 filings in the last year');
    expect(find(viewProps({ result: { company: APPLE, filings: [] } }), (element) => element.type === EmptyState)?.props.title).toBe(FILINGS_EMPTY_TITLE);
  });

  test('shows a failed load as an alert', () => {
    const html = renderToStaticMarkup(<FilingsView {...viewProps({ result: undefined, error: 'could not load' })} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('could not load');
  });
});

describe('FilingsPage against an API stub', () => {
  function viewOf(tree: ReactElement<Record<string, unknown>>): FilingsViewProps {
    return tree.props as unknown as FilingsViewProps;
  }

  test('with no CIK, asks the server nothing', async () => {
    const { api, calls } = stubApi();
    const page = await settle(<FilingsPage api={api} />);
    page.stop();
    expect(calls).toEqual([]);
    expect(viewOf(page.tree).cik).toBeUndefined();
  });

  test('finds the company by its CIK, then loads its year once, in pages of the route\'s largest size', async () => {
    const { api, calls } = stubApi();
    const page = await settle(<FilingsPage api={api} cik={APPLE.cik} />);
    page.stop();
    expect(calls).toEqual([
      ['findCompany', APPLE.cik],
      ['list', 'AAPL', 1, FILINGS_PAGE_SIZE],
    ]);
    expect(viewOf(page.tree).result?.filings).toHaveLength(4);
  });

  test('reads every page of a year that does not fit in one, in order', async () => {
    const asked: number[] = [];
    const api: FilingsPageApi = {
      ...stubApi().api,
      list: async (_ticker, number) => {
        asked.push(number);
        return pageOf([number === 1
          ? TEN_K
          : EIGHT_K_A], 2, number);
      },
    };
    const page = await settle(<FilingsPage api={api} cik={APPLE.cik} />);
    page.stop();
    expect(asked).toEqual([1, 2]);
    expect(viewOf(page.tree).result?.filings).toEqual([TEN_K, EIGHT_K_A]);
  });

  test('a form picked filters what is held, with no new call', async () => {
    const { api, calls } = stubApi();
    const page = await settle(<FilingsPage api={api} cik={APPLE.cik} />);
    viewOf(page.tree).onFormChange?.('4');
    await page.flush();
    page.stop();
    expect(calls).toHaveLength(2);
    expect(viewOf(page.tree).form).toBe('4');
  });

  test('a CIK no company has is reported as missing, with no list asked for', async () => {
    const { api, calls } = stubApi();
    const page = await settle(<FilingsPage api={api} cik={42} />);
    page.stop();
    expect(calls).toEqual([['findCompany', 42]]);
    expect(viewOf(page.tree).missing).toBe(true);
  });

  test('a refused load becomes the view\'s error', async () => {
    const api: FilingsPageApi = {
      findCompany: async () => APPLE,
      list: async () => {
        throw new Error('the server is down');
      },
      select: async () => APPLE,
    };
    const page = await settle(<FilingsPage api={api} cik={APPLE.cik} />);
    page.stop();
    expect(viewOf(page.tree).error).toBe('the server is down');
  });

  test('the card\'s switch sets the company in the summary and shows the answer', async () => {
    const { api, calls } = stubApi();
    const page = await settle(<FilingsPage api={api} cik={APPLE.cik} />);
    viewOf(page.tree).onSelectedChange?.('AAPL', false);
    await page.flush();
    page.stop();
    expect(calls.at(-1)).toEqual(['select', 'AAPL', false]);
    expect(viewOf(page.tree).result?.company.selected).toBe(false);
  });

  test('hands its onSearch to the view, the topbar search\'s focus by default', async () => {
    let searched = 0;
    const page = await settle(<FilingsPage api={stubApi().api} onSearch={() => (searched += 1)} />);
    page.stop();
    viewOf(page.tree).onSearch?.();
    expect(searched).toBe(1);
  });
});
