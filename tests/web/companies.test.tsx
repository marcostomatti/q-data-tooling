import type { CompanyPage, CompanyQuery } from '../../src/web/api.ts';

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { pageFor } from '../../src/web/app.tsx';
import {
  CompaniesPage,
  CompaniesView,
  COMPANIES_EMPTY_DESCRIPTION,
  COMPANIES_EMPTY_TITLE,
  COMPANIES_PAGE_SIZE,
  COMPANIES_TITLE,
  INITIAL_QUERY,
  pageCountOf,
  SELECTED_ONLY_LABEL,
  withSearch,
  withSelectedOnly,
} from '../../src/web/pages/companies.tsx';

const EMPTY: CompanyPage = { items: [], page: 1, pageSize: COMPANIES_PAGE_SIZE, total: 0 };

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

describe('CompaniesPage', () => {
  test('renders its first page with no server answer yet', () => {
    const api = { list: async (): Promise<CompanyPage> => EMPTY };
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
