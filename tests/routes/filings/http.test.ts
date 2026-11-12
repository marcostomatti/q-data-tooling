import { describe, expect, test } from 'bun:test';

import { filingListRoute, filingRoutes, filingSummaryRoute } from '../../../src/routes/filings/http.ts';
import { filingListTool, filingSummaryTool } from '../../../src/routes/filings/tool.ts';
import { ROUTES } from '../../../src/routes/http.ts';

describe('the filings routes in the table', () => {
  test('are listed in ROUTES on their tools\' own schema objects', () => {
    expect(ROUTES).toEqual(expect.arrayContaining([...filingRoutes]));
    expect(filingListRoute).toMatchObject({ method: 'get', path: '/companies/:ticker/filings', tools: ['filing_list'] });
    expect(filingSummaryRoute).toMatchObject({ method: 'get', path: '/filings/summary', tools: ['filing_summary'] });
    expect(filingListRoute.schemas[0]).toBe(filingListTool.input);
    expect(filingSummaryRoute.schemas[0]).toBe(filingSummaryTool.input);
  });

  test('each carries a summary for the OpenAPI document', () => {
    for (const spec of filingRoutes) expect(spec.docs.summary.trim().length).toBeGreaterThan(0);
  });
});
