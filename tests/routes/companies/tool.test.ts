import { describe, expect, test } from 'bun:test';

import { CompanyListInput, CompanyUpdateInput, DOMAIN } from '../../../src/routes/companies/contract.ts';
import { STUB_COMPANIES } from '../../../src/routes/companies/stub.ts';
import { companyListTool, companyTools, companyUpdateTool } from '../../../src/routes/companies/tool.ts';
import { captureLog } from '../../support/capture-log.ts';
import { connectTools, untouchableDb } from '../../support/tool-harness.ts';

describe('the company_list tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(companyListTool.name).toBe('company_list');
    expect(companyListTool.input).toBe(CompanyListInput);
    expect(companyListTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call answers one page of the stub companies without touching the database', async () => {
    const tools = await connectTools(companyTools, untouchableDb());
    const outcome = await tools.call('company_list', { pageSize: 1 });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toEqual({ items: STUB_COMPANIES.slice(0, 1), page: 1, pageSize: 1, total: STUB_COMPANIES.length });
  });

  test('a call writes the flow\'s line under the Companies domain, which tool.ts binds', async () => {
    const captured = captureLog();
    const tools = await connectTools(companyTools, untouchableDb(), captured.log);

    await tools.call('company_list', {});

    expect(captured.records).toHaveLength(1);
    expect(captured.records[0]).toMatchObject({ domain: DOMAIN, scope: 'list', step: 'read', level: 'debug' });
    expect(DOMAIN).toBe('Companies');
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

  test('a call answers the company with the flag set', async () => {
    const tools = await connectTools(companyTools, untouchableDb());
    const outcome = await tools.call('company_update', { ticker: 'aapl', selected: false });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toEqual({ ...STUB_COMPANIES.find((company) => company.ticker === 'AAPL'), selected: false });
  });

  test('a call for a ticker no company trades under fails', async () => {
    const tools = await connectTools(companyTools, untouchableDb());
    const outcome = await tools.call('company_update', { ticker: 'NOPE', selected: true });
    expect(outcome).toEqual({ failed: true, body: { error: { name: 'NotFoundError', message: 'company NOPE does not exist' } } });
  });

  test('a call without selected is refused', async () => {
    const tools = await connectTools(companyTools, untouchableDb());
    const outcome = await tools.call('company_update', { ticker: 'AAPL' });
    expect(outcome.failed).toBe(true);
  });
});
