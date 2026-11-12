import { describe, expect, test } from 'bun:test';

import { CompanyListInput, CompanyUpdateInput } from '../../../src/routes/companies/contract.ts';
import { companyListTool, companyTools, companyUpdateTool } from '../../../src/routes/companies/tool.ts';
import { connectTools, untouchableDb } from '../../support/tool-harness.ts';

describe('the company_list tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(companyListTool.name).toBe('company_list');
    expect(companyListTool.input).toBe(CompanyListInput);
    expect(companyListTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call with a stray argument is refused', async () => {
    const tools = await connectTools(companyTools, untouchableDb());
    const outcome = await tools.call('company_list', { extra: 1 });
    expect(outcome.failed).toBe(true);
  });
});

describe('the company_update tool', () => {
  test('is defined on the shared schema object, writes, and is idempotent', () => {
    expect(companyUpdateTool.name).toBe('company_update');
    expect(companyUpdateTool.input).toBe(CompanyUpdateInput);
    expect(companyUpdateTool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  });

  test('a call without selected is refused', async () => {
    const tools = await connectTools(companyTools, untouchableDb());
    const outcome = await tools.call('company_update', { ticker: 'AAPL' });
    expect(outcome.failed).toBe(true);
  });
});
