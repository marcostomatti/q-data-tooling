import type { Company, CompanyPage, CompanyQuery } from '../../src/web/api.ts';
import type { ReactElement } from 'react';

import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApiError, createCompaniesClient } from '../../src/web/api.ts';
import { pageFor } from '../../src/web/app.tsx';
import { FilingsDialog } from '../../src/web/components/filings-view.tsx';
import {
  CompaniesPage,
  CompaniesView,
  CompanyRow,
  COMPANIES_EMPTY_DESCRIPTION,
  COMPANIES_EMPTY_TITLE,
  COMPANIES_PAGE_SIZE,
  COMPANIES_TITLE,
  INITIAL_QUERY,
  NO_EXCHANGE,
  NOT_SYNCED,
  pageCountOf,
  SELECTED_ONLY_LABEL,
  withCompany,
  withSearch,
  withSelectedOnly,
} from '../../src/web/pages/companies.tsx';

const EMPTY: CompanyPage = { items: [], page: 1, pageSize: COMPANIES_PAGE_SIZE, total: 0 };

/** Apple as the server answers it after a sync, in the summary. */
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

/** Microsoft as the server answers it before its first sync, out of the summary. */
const MICROSOFT: Company = {
  ...APPLE,
  cik: 789019,
  cik10: '0000789019',
  ticker: 'MSFT',
  name: 'Microsoft Corp',
  selected: false,
  exchanges: [],
  filingsSyncedAt: null,
};

const TWO: CompanyPage = { ...EMPTY, items: [APPLE, MICROSOFT], total: 2 };

/** A stand-in for the server that answers every list with `page` and every change as asked. */
const stubApi = (page: CompanyPage) => ({
  list: async (): Promise<CompanyPage> => page,
  select: async (ticker: string, selected: boolean): Promise<Company> => ({ ...APPLE, ticker, selected }),
});

/** The props a `CompanyRow` hands its `RowStatCard`, read without a DOM by calling the row. */
interface CardProps {
  readonly subtitle: ReactElement<{ variant: string, onClick: () => void }>
  readonly action: ReactElement<{ onChange: (next: boolean) => void }>
}

/** The attribute React writes for a disabled button; the class list also holds `disabled:` variants. */
const DISABLED_ATTR = ' disabled=""';

/** A `<button>` tag holding `label`, so a test can read its `disabled` attribute. */
function buttonTag(html: string, label: string): string {
  const match = new RegExp(`<button[^>]*>${label}</button>`).exec(html);
  if (match === null) throw new Error(`no ${label} button in the markup`);
  return match[0];
}

describe('CompaniesView', () => {
  test('shows its title and the empty state', () => {
    const html = renderToStaticMarkup(<CompaniesView />);
    expect(html).toContain(`<h1>${COMPANIES_TITLE}</h1>`);
    expect(html).toContain(COMPANIES_EMPTY_TITLE);
    expect(html).toContain(COMPANIES_EMPTY_DESCRIPTION);
  });

  test('the toolbar holds the search text, the selected-only filter and the page', () => {
    const html = renderToStaticMarkup(
      <CompaniesView search="app" selectedOnly result={{ ...EMPTY, page: 2, total: 60 }} />,
    );
    expect(html).toContain('value="app"');
    expect(html).toContain('aria-label="Search companies"');
    expect(html).toContain(SELECTED_ONLY_LABEL);
    expect(html).toContain('role="checkbox" aria-checked="true"');
    expect(html).toContain('60 companies');
    expect(html).toContain('Page 2 of 3');
  });

  test('the filter reads unchecked when off', () => {
    const html = renderToStaticMarkup(<CompaniesView />);
    expect(html).toContain('role="checkbox" aria-checked="false"');
  });

  test('Previous is disabled on page 1 and Next on the last page', () => {
    const first = renderToStaticMarkup(<CompaniesView result={{ ...EMPTY, total: 60 }} />);
    expect(buttonTag(first, 'Previous')).toContain(DISABLED_ATTR);
    expect(buttonTag(first, 'Next')).not.toContain(DISABLED_ATTR);

    const last = renderToStaticMarkup(<CompaniesView result={{ ...EMPTY, page: 3, total: 60 }} />);
    expect(buttonTag(last, 'Previous')).not.toContain(DISABLED_ATTR);
    expect(buttonTag(last, 'Next')).toContain(DISABLED_ATTR);
  });

  test('an error shows an alert instead of the empty state', () => {
    const html = renderToStaticMarkup(<CompaniesView error="the server answered 500" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('the server answered 500');
    expect(html).not.toContain(COMPANIES_EMPTY_TITLE);
  });

  test('the nav finds the page at /companies', () => {
    expect(pageFor('/companies').path).toBe('/companies');
    expect(pageFor('/companies').label).toBe(COMPANIES_TITLE);
  });
});

describe('CompanyRow', () => {
  test('shows the ticker, the name as a button and the three ministats', () => {
    const html = renderToStaticMarkup(<CompanyRow company={APPLE} />);
    expect(html).toContain('AAPL');
    expect(html).toMatch(/<button[^>]*>Apple Inc\.<\/button>/);
    expect(html).toContain('320193');
    expect(html).toContain('Nasdaq');
    expect(html).toContain('2026-11-10');
  });

  test('the switch reads the company\'s selected flag', () => {
    expect(renderToStaticMarkup(<CompanyRow company={APPLE} />)).toContain('role="switch" aria-checked="true"');
    expect(renderToStaticMarkup(<CompanyRow company={MICROSOFT} />)).toContain('role="switch" aria-checked="false"');
    expect(renderToStaticMarkup(<CompanyRow company={MICROSOFT} />)).toContain('aria-label="Show Microsoft Corp in the summary"');
  });

  test('an unsynced company shows no exchange and never', () => {
    const html = renderToStaticMarkup(<CompanyRow company={MICROSOFT} />);
    expect(html).toContain(NO_EXCHANGE);
    expect(html).toContain(NOT_SYNCED);
  });

  test('the name is a ghost button that opens the filings by ticker', () => {
    const opened: string[] = [];
    const card = CompanyRow({ company: APPLE, onOpenFilings: (ticker) => opened.push(ticker) }) as ReactElement<CardProps>;
    expect(card.props.subtitle.props.variant).toBe('ghost');
    card.props.subtitle.props.onClick();
    expect(opened).toEqual(['AAPL']);
  });

  test('the switch hands on its next state as an explicit boolean, with the ticker', () => {
    const sent: Array<[string, boolean]> = [];
    const card = CompanyRow({ company: APPLE, onSelectedChange: (ticker, next) => sent.push([ticker, next]) }) as ReactElement<CardProps>;
    card.props.action.props.onChange(false);
    card.props.action.props.onChange(true);
    expect(sent).toEqual([['AAPL', false], ['AAPL', true]]);
  });
});

describe('the rows', () => {
  test('the view draws one row per company and no empty state', () => {
    const html = renderToStaticMarkup(<CompaniesView result={TWO} />);
    expect(html).toContain('Apple Inc.');
    expect(html).toContain('Microsoft Corp');
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).not.toContain(COMPANIES_EMPTY_TITLE);
  });

  test('a failed change keeps the rows under the alert', () => {
    const html = renderToStaticMarkup(<CompaniesView result={TWO} error="could not update AAPL" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Apple Inc.');
  });

  test('the server\'s answer replaces the company with its ticker, and nothing else', () => {
    const next = withCompany(TWO, { ...MICROSOFT, selected: true });
    expect(next.items.map((item) => item.selected)).toEqual([true, true]);
    expect(next.items[0]).toBe(APPLE);
    expect(TWO.items[1]?.selected).toBe(false);
  });

  test('an answer for a company the page no longer holds leaves the same page', () => {
    expect(withCompany(TWO, { ...APPLE, ticker: 'NVDA' })).toBe(TWO);
  });
});

describe('CompaniesPage', () => {
  test('renders the rows of its first page', () => {
    const html = renderToStaticMarkup(<CompaniesPage api={stubApi(TWO)} initial={TWO} />);
    expect(html).toContain('Apple Inc.');
    expect(html).toContain('2 companies');
  });

  test('renders its first page with no server answer yet', () => {
    const api = stubApi(EMPTY);
    const html = renderToStaticMarkup(<CompaniesPage api={api} initial={{ ...EMPTY, total: 1 }} />);
    expect(html).toContain('1 company');
    expect(html).toContain('Page 1 of 1');
  });
});

describe('the toolbar query', () => {
  const onPage3: CompanyQuery = { ...INITIAL_QUERY, page: 3 };

  test('a new search trims the text and goes back to page 1', () => {
    expect(withSearch(onPage3, '  aapl ')).toEqual({ ...INITIAL_QUERY, q: 'aapl', page: 1 });
  });

  test('an unchanged search keeps the same query object, so nothing refetches', () => {
    const query = { ...onPage3, q: 'aapl' };
    expect(withSearch(query, 'aapl ')).toBe(query);
  });

  test('the selected-only filter goes back to page 1', () => {
    expect(withSelectedOnly(onPage3, true)).toEqual({ ...INITIAL_QUERY, selectedOnly: true, page: 1 });
  });

  test('the page count is at least 1 and rounds up', () => {
    expect(pageCountOf(0, 25)).toBe(1);
    expect(pageCountOf(25, 25)).toBe(1);
    expect(pageCountOf(26, 25)).toBe(2);
  });
});

/** React's private hook dispatcher slot; a probe stands in it because no DOM is available to run effects. */
const INTERNALS = (React as unknown as Record<string, { H: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };

/** The most render passes a settle may take before a test calls it a loop. */
const MAX_PASSES = 10;

interface PendingEffect { readonly slot: number, readonly run: () => void | (() => void), readonly deps: readonly unknown[] | undefined }

/** A driven component: its last tree, a `flush` that renders again until quiet, and a `stop` that runs the live cleanups. */
interface Settled {
  tree: ReactElement<Record<string, unknown>>
  flush: () => Promise<void>
  stop: () => void
}

/**
 * Drives a component with `useState` and `useEffect` and no DOM: renders, runs the effects whose
 * deps changed, lets the promises they started settle, and renders again until nothing changes.
 *
 * @param element - The element to drive; its type is called as a plain function.
 * @returns The driven component, as {@link Settled} lists it.
 */
async function settle(element: ReactElement<Record<string, unknown>>): Promise<Settled> {
  const state: unknown[] = [];
  const lastDeps: Array<readonly unknown[] | undefined> = [];
  const cleanups: Array<void | (() => void)> = [];
  let pending: PendingEffect[] = [];
  let dirty = false;
  const settled: Settled = {
    tree: element,
    flush: async () => {
      await flush();
    },
    stop: () => cleanups.forEach((cleanup) => typeof cleanup === 'function' && cleanup()),
  };
  async function flush(): Promise<void> {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let stateSlot = 0;
      let effectSlot = 0;
      dirty = false;
      const previous = INTERNALS.H;
      INTERNALS.H = {
        useState: (init: unknown) => {
          const slot = stateSlot++;
          if (!(slot in state)) state[slot] = typeof init === 'function'
            ? (init as () => unknown)()
            : init;
          return [state[slot], (next: unknown) => {
            const value = typeof next === 'function'
              ? (next as (current: unknown) => unknown)(state[slot])
              : next;
            if (!Object.is(value, state[slot])) dirty = true;
            state[slot] = value;
          }];
        },
        useEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => {
          const slot = effectSlot++;
          const before = lastDeps[slot];
          const changed = deps === undefined || before === undefined || deps.some((dep, index) => !Object.is(dep, before[index]));
          if (changed) pending.push({ slot, run, deps });
        },
      };
      try {
        settled.tree = (element.type as (props: unknown) => ReactElement<Record<string, unknown>>)(element.props);
      } finally {
        INTERNALS.H = previous;
      }
      for (const effect of pending) {
        const cleanup = cleanups[effect.slot];
        if (typeof cleanup === 'function') cleanup();
        lastDeps[effect.slot] = effect.deps;
        cleanups[effect.slot] = effect.run();
      }
      pending = [];
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!dirty) break;
    }
  }
  await flush();
  return settled;
}

/** A `fetch` stand-in that records `METHOD path body` per call and answers each with `body` and `status`. */
function recordingFetch(body: unknown, status = 200): { fetchImpl: typeof fetch, calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = async (path: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(`${init?.method} ${String(path)} ${String(init?.body ?? '')}`.trim());
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

/** The page's two children: the Companies view, then the filings dialog. */
function childrenOf(tree: ReactElement<Record<string, unknown>>): ReactElement<Record<string, unknown>>[] {
  return tree.props.children as ReactElement<Record<string, unknown>>[];
}

function viewOf(tree: ReactElement<Record<string, unknown>>): ReactElement<Record<string, unknown>> {
  return childrenOf(tree)[0] as ReactElement<Record<string, unknown>>;
}

function dialogOf(tree: ReactElement<Record<string, unknown>>): ReactElement<Record<string, unknown>> {
  return childrenOf(tree)[1] as ReactElement<Record<string, unknown>>;
}

describe('CompaniesPage against an API stub', () => {
  test('a row name opens the filings view for its ticker and closing it clears the ticker', async () => {
    const opened: string[] = [];
    const page = await settle(<CompaniesPage api={stubApi(TWO)} initial={TWO} onOpenFilings={(ticker) => opened.push(ticker)} />);
    expect(dialogOf(page.tree).type).toBe(FilingsDialog);
    expect(dialogOf(page.tree).props.ticker).toBeUndefined();

    (viewOf(page.tree).props.onOpenFilings as (ticker: string) => void)('AAPL');
    await page.flush();
    expect(dialogOf(page.tree).props.ticker).toBe('AAPL');
    expect(opened).toEqual(['AAPL']);

    (dialogOf(page.tree).props.onClose as () => void)();
    await page.flush();
    page.stop();
    expect(dialogOf(page.tree).props.ticker).toBeUndefined();
  });

  test('an API error shows a message and not the empty list', async () => {
    const { fetchImpl, calls } = recordingFetch({ success: false, error: { name: 'Boom', message: 'the registry is down' } }, 503);
    const { tree, stop } = await settle(<CompaniesPage api={createCompaniesClient(fetchImpl)} />);
    stop();
    expect(calls).toEqual(['GET /api/companies?page=1&pageSize=25']);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('role="alert"');
    expect(html).toContain('the registry is down');
    expect(html).not.toContain(COMPANIES_EMPTY_TITLE);
  });

  test('a failure that is not an Error still shows a message', async () => {
    const api = { ...stubApi(EMPTY), list: () => Promise.reject(new ApiError(500, 'Error', 'the server answered 500')) };
    const { tree, stop } = await settle(<CompaniesPage api={api} />);
    stop();
    expect(renderToStaticMarkup(tree)).toContain('the server answered 500');
  });

  test('rows render from the API stub', async () => {
    const { fetchImpl, calls } = recordingFetch({ success: true, data: TWO });
    const { tree, stop } = await settle(<CompaniesPage api={createCompaniesClient(fetchImpl)} />);
    stop();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toBe('GET /api/companies?page=1&pageSize=25');
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Apple Inc.');
    expect(html).toContain('Microsoft Corp');
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).not.toContain(COMPANIES_EMPTY_TITLE);
  });

  test('the switch sends the PATCH with an explicit boolean and the row takes the answer', async () => {
    const answers = [{ success: true, data: TWO }, { success: true, data: { ...APPLE, selected: false } }];
    const calls: string[] = [];
    const fetchImpl = (async (path: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(path)} ${String(init?.body ?? '')}`.trim());
      return new Response(JSON.stringify(answers[calls.length - 1]));
    }) as typeof fetch;
    const page = await settle(<CompaniesPage api={createCompaniesClient(fetchImpl)} />);
    expect(calls.length).toBeGreaterThan(0);
    expect(renderToStaticMarkup(page.tree)).toContain('role="switch" aria-checked="true"');

    const onChange = viewOf(page.tree).props.onSelectedChange as (ticker: string, selected: boolean) => void;
    onChange('AAPL', false);
    await page.flush();
    page.stop();

    expect(calls).toEqual(['GET /api/companies?page=1&pageSize=25', 'PATCH /api/companies/AAPL {"selected":false}']);
    expect(renderToStaticMarkup(page.tree).match(/role="switch" aria-checked="false"/g)).toHaveLength(2);
  });
});
