import type { Company, CompanyPage, CompanyQuery } from '../../src/web/api.ts';
import type { SearchSuggestion } from '@open-tomato/components';

import { EntityKindsProvider, SearchSuggest } from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Shell, pageFor } from '../../src/web/app.tsx';
import { CompanySearch } from '../../src/web/components/company-search/index.tsx';
import {
  COMPANY_ICON,
  FAILED_ICON,
  focusCompanySearch,
  kindsOf,
  SEARCH_FAILED_LABEL,
  SEARCH_HOTKEY,
  SEARCH_PLACEHOLDER,
  SUGGESTION_COUNT,
  suggestionOf,
} from '../../src/web/components/company-search/logic.ts';

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

const UNSYNCED: Company = { ...APPLE, cik: 1750, cik10: '0000001750', ticker: 'AIR', name: 'AAR Corp', exchanges: [], filingsSyncedAt: null };

/** The library's own match: the typed text, in any case, inside the label and the second line. */
function libraryKeeps(suggestion: SearchSuggestion, typed: string): boolean {
  return `${suggestion.label} ${suggestion.sub ?? ''}`.toLowerCase().includes(typed.trim().toLowerCase());
}

/** A stand-in for `GET /api/companies` that answers `items` and records each query. */
function stubApi(items: readonly Company[]) {
  const queries: CompanyQuery[] = [];
  const api = {
    list: async (query: CompanyQuery): Promise<CompanyPage> => {
      queries.push(query);
      return { items: [...items], total: items.length, page: 1, pageSize: query.pageSize };
    },
  };
  return { api, queries };
}

function suggestOf(tree: AnyElement): AnyElement | undefined {
  return findElement(tree, (element) => element.type === SearchSuggest);
}

/** Types into the search the way the input's change event bubbles to the wrapper. */
function type(tree: AnyElement, text: string): void {
  (tree.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: text } });
}

describe('a company as a suggestion', () => {
  test('names the company on top, and its ticker, CIK and exchange on the line below', () => {
    expect(suggestionOf(APPLE)).toEqual({ kind: 'AAPL', icon: COMPANY_ICON, label: 'Apple Inc.', sub: 'AAPL · CIK 0000320193 · Nasdaq' });
    expect(suggestionOf(UNSYNCED).sub).toBe('AIR · CIK 0000001750');
  });

  test('passes the library\'s own filter for each way the server matched it', () => {
    const apple = suggestionOf(APPLE);
    for (const typed of ['aap', 'AAPL', 'apple', 'Inc', '320193', '0000320193']) {
      expect(libraryKeeps(apple, typed)).toBe(true);
    }
  });

  test('gives every ticker the same kind with no tone, so each pill is the default accent with the ticker in it', () => {
    expect(kindsOf([APPLE, UNSYNCED])).toEqual({ AAPL: {}, AIR: {} });
  });

  test('marks each company with the landmark the Filings page shows, where a pick leads', () => {
    expect(COMPANY_ICON).toBe('landmark');
    expect(suggestionOf(UNSYNCED).icon).toBe(COMPANY_ICON);
  });
});

describe('focusCompanySearch', () => {
  test('presses ⌘K on the target, the keystroke the library search answers by focusing its input', () => {
    const sent: Event[] = [];
    const target = { dispatchEvent: (event: Event) => sent.push(event) > 0 };

    // Bun has no KeyboardEvent, so the stand-in is a plain object with the fields the library reads.
    focusCompanySearch(target, (init) => ({ type: 'keydown', ...init }) as unknown as Event);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('keydown');
    // The library's own check, in SearchSuggest's window keydown listener.
    const { key, metaKey, ctrlKey } = sent[0] as unknown as KeyboardEventInit;
    expect((metaKey === true || ctrlKey === true) && key?.toLowerCase() === 'k').toBe(true);
    expect(SEARCH_HOTKEY.bubbles).toBe(true);
  });
});

describe('CompanySearch', () => {
  test('suggests nothing and asks nothing before any typing', async () => {
    const { api, queries } = stubApi([APPLE]);
    const search = await settle(<CompanySearch api={api} debounceMs={0} />);
    search.stop();
    expect(queries).toEqual([]);
    expect(suggestOf(search.tree)?.props.suggestions).toEqual([]);
    expect(suggestOf(search.tree)?.props.placeholder).toBe(SEARCH_PLACEHOLDER);
    expect(SEARCH_PLACEHOLDER).toBe('Ticker, CIK or company…');
  });

  test('asks the server for the text typed, and suggests what it answers under one kind per ticker', async () => {
    const { api, queries } = stubApi([APPLE]);
    const search = await settle(<CompanySearch api={api} debounceMs={0} />);
    type(search.tree, ' apple ');
    await search.flush();
    search.stop();
    expect(queries).toEqual([{ page: 1, pageSize: SUGGESTION_COUNT, q: 'apple', selectedOnly: false }]);
    expect(suggestOf(search.tree)?.props.suggestions).toEqual([suggestionOf(APPLE)]);
    const provider = findElement(search.tree, (element) => element.type === EntityKindsProvider);
    expect(provider?.props.kinds).toEqual({ AAPL: {} });
  });

  test('picking a suggestion hands its company\'s CIK to the caller', async () => {
    const picked: number[] = [];
    const { api } = stubApi([APPLE]);
    const search = await settle(<CompanySearch api={api} debounceMs={0} onPick={(cik) => picked.push(cik)} />);
    type(search.tree, 'aapl');
    await search.flush();
    search.stop();
    (suggestOf(search.tree)?.props.onSelect as (suggestion: SearchSuggestion) => void)(suggestionOf(APPLE));
    expect(picked).toEqual([320193]);
  });

  test('Enter with no row picked opens the first company found', async () => {
    const picked: number[] = [];
    const { api } = stubApi([APPLE, UNSYNCED]);
    const search = await settle(<CompanySearch api={api} debounceMs={0} onPick={(cik) => picked.push(cik)} />);
    type(search.tree, 'a');
    await search.flush();
    search.stop();
    (suggestOf(search.tree)?.props.onSearch as (query: string) => void)('a');
    expect(picked).toEqual([320193]);
  });

  test('a refused search shows as one row the library keeps, naming the failure, that opens nothing', async () => {
    const picked: number[] = [];
    const api = {
      list: async (): Promise<CompanyPage> => {
        throw new Error('the server is down');
      },
    };
    const search = await settle(<CompanySearch api={api} debounceMs={0} onPick={(cik) => picked.push(cik)} />);
    type(search.tree, 'apple');
    await search.flush();
    search.stop();
    const [row] = suggestOf(search.tree)?.props.suggestions as SearchSuggestion[];
    expect(row?.label).toBe(SEARCH_FAILED_LABEL);
    expect(row?.icon).toBe(FAILED_ICON);
    expect(row?.sub).toContain('the server is down');
    expect(libraryKeeps(row as SearchSuggestion, 'apple')).toBe(true);
    (suggestOf(search.tree)?.props.onSelect as (suggestion: SearchSuggestion) => void)(row as SearchSuggestion);
    expect(picked).toEqual([]);
  });

  test('clearing the text drops the suggestions', async () => {
    const { api } = stubApi([APPLE]);
    const search = await settle(<CompanySearch api={api} debounceMs={0} />);
    type(search.tree, 'apple');
    await search.flush();
    type(search.tree, '');
    await search.flush();
    search.stop();
    expect(suggestOf(search.tree)?.props.suggestions).toEqual([]);
  });
});

describe('the search in the topbar', () => {
  test('sits between the page title and the theme switch', () => {
    const html = renderToStaticMarkup(
      <Shell current={pageFor('/tokens')} onSignOut={() => undefined} onNavigate={() => undefined}>
        <p>body</p>
      </Shell>,
    );
    expect(html).toMatch(/<h1[^>]*>Tokens<\/h1>.*placeholder="Ticker, CIK or company…".*aria-label="Switch to dark theme"/);
  });
});
