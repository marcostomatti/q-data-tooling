import { describe, expect, test } from 'bun:test';

import { companyListRoute, companyRoutes, companyUpdateRoute } from '../../../src/routes/companies/http.ts';
import { companyListTool, companyUpdateTool } from '../../../src/routes/companies/tool.ts';
import { ROUTES } from '../../../src/routes/http.ts';

describe('the companies routes in the table', () => {
  test('are listed in ROUTES on their tools\' own schema objects', () => {
    expect(ROUTES).toEqual(expect.arrayContaining([...companyRoutes]));
    expect(companyListRoute).toMatchObject({ method: 'get', path: '/companies', tools: ['company_list'] });
    expect(companyUpdateRoute).toMatchObject({ method: 'patch', path: '/companies/:ticker', tools: ['company_update'] });
    expect(companyListRoute.schemas[0]).toBe(companyListTool.input);
    expect(companyUpdateRoute.schemas[0]).toBe(companyUpdateTool.input);
  });

  test('each carries a summary for the OpenAPI document', () => {
    for (const spec of companyRoutes) expect(spec.docs.summary.trim().length).toBeGreaterThan(0);
  });
});
