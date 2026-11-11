import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { pageFor } from '../../src/web/app.tsx';
import {
  COMPANIES_EMPTY_DESCRIPTION,
  COMPANIES_EMPTY_TITLE,
  COMPANIES_TITLE,
  CompaniesView,
} from '../../src/web/pages/companies.tsx';

describe('CompaniesView', () => {
  test('shows its title and the empty state', () => {
    const html = renderToStaticMarkup(<CompaniesView />);
    expect(html).toContain(`<h1>${COMPANIES_TITLE}</h1>`);
    expect(html).toContain(COMPANIES_EMPTY_TITLE);
    expect(html).toContain(COMPANIES_EMPTY_DESCRIPTION);
  });

  test('the nav finds the page at /companies', () => {
    expect(pageFor('/companies').path).toBe('/companies');
    expect(pageFor('/companies').label).toBe(COMPANIES_TITLE);
  });
});
