import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { pageFor } from '../../src/web/app.tsx';
import {
  SUMMARY_EMPTY_DESCRIPTION,
  SUMMARY_EMPTY_TITLE,
  SUMMARY_TITLE,
  SummaryView,
} from '../../src/web/pages/summary.tsx';

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
