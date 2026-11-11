import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { CompanyListInput, CompanyUpdateInput, DOMAIN } from '../../../src/routes/companies/contract.ts';
import { companyListTool, companyTools, companyUpdateTool } from '../../../src/routes/companies/tool.ts';
import { captureLog } from '../../support/capture-log.ts';
import { connectTools, untouchableDb } from '../../support/tool-harness.ts';

import { openSeededCompaniesDb, SEEDED_TICKERS_BY_NAME, storedSelected } from './seeded-db.ts';

let db: SqliteTestClient;

beforeEach(async () => {
  db = await openSeededCompaniesDb();
});

afterEach(() => {
  db.$client.close();
});

describe('the company_list tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(companyListTool.name).toBe('company_list');
    expect(companyListTool.input).toBe(CompanyListInput);
    expect(companyListTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call answers one page of the stored companies, by name, with the total', async () => {
    const tools = await connectTools(companyTools, db);
    const outcome = await tools.call('company_list', { pageSize: 1 });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({ items: [{ ticker: SEEDED_TICKERS_BY_NAME[0] }], page: 1, pageSize: 1, total: SEEDED_TICKERS_BY_NAME.length });
  });

  test('a call writes the flow\'s line under the Companies domain, which tool.ts binds', async () => {
    const captured = captureLog();
    const tools = await connectTools(companyTools, db, captured.log);

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

  test('a call stores the flag and answers the company with it set', async () => {
    const tools = await connectTools(companyTools, db);
    const outcome = await tools.call('company_update', { ticker: 'aapl', selected: true });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({ cik: 320193, ticker: 'AAPL', name: 'Apple Inc.', selected: true });
    expect(storedSelected(db, 320193)).toBe(true);
  });

  test('a call for a ticker no company trades under fails', async () => {
    const tools = await connectTools(companyTools, db);
    const outcome = await tools.call('company_update', { ticker: 'NOPE', selected: true });
    expect(outcome).toEqual({ failed: true, body: { error: { name: 'NotFoundError', message: 'company NOPE does not exist' } } });
  });

  test('a call without selected is refused', async () => {
    const tools = await connectTools(companyTools, untouchableDb());
    const outcome = await tools.call('company_update', { ticker: 'AAPL' });
    expect(outcome.failed).toBe(true);
  });
});
