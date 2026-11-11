import type { SqliteTestClient } from '../../support/sqlite-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DOMAIN, FilingListInput, SummaryInput } from '../../../src/routes/filings/contract.ts';
import { filingListTool, filingSummaryTool, filingTools } from '../../../src/routes/filings/tool.ts';
import { captureLog } from '../../support/capture-log.ts';
import { connectTools, untouchableDb } from '../../support/tool-harness.ts';
import { FIXED_FILINGS } from '../fixtures.ts';

import { APPLE_CIK, openSeededFilingsDb } from './seeded-db.ts';

let db: SqliteTestClient;

beforeAll(async () => {
  db = await openSeededFilingsDb();
});

afterAll(() => {
  db.$client.close();
});

describe('the filing_list tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(filingListTool.name).toBe('filing_list');
    expect(filingListTool.input).toBe(FilingListInput);
    expect(filingListTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call answers the stored company and one page of its stored filings', async () => {
    const tools = await connectTools(filingTools, db);
    const outcome = await tools.call('filing_list', { ticker: 'aapl', pageSize: 1 });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({
      company: { cik: APPLE_CIK, ticker: 'AAPL', name: 'Apple Inc.' },
      filings: { items: FIXED_FILINGS.slice(0, 1), page: 1, pageSize: 1, total: FIXED_FILINGS.length },
    });
  });

  test('a call for a ticker no company trades under fails', async () => {
    const tools = await connectTools(filingTools, db);
    const outcome = await tools.call('filing_list', { ticker: 'NOPE' });
    expect(outcome).toEqual({ failed: true, body: { error: { name: 'NotFoundError', message: 'company NOPE does not exist' } } });
  });

  test('a call writes the flow\'s line under the Filings domain, which tool.ts binds', async () => {
    const captured = captureLog();
    const tools = await connectTools(filingTools, db, captured.log);

    await tools.call('filing_list', { ticker: 'AAPL' });

    expect(captured.records).toHaveLength(1);
    expect(captured.records[0]).toMatchObject({ domain: DOMAIN, scope: 'list', step: 'read', level: 'debug' });
    expect(DOMAIN).toBe('Filings');
  });

  test('a call with an unknown form or without a ticker is refused', async () => {
    const tools = await connectTools(filingTools, untouchableDb());
    expect((await tools.call('filing_list', { ticker: 'AAPL', form: 'S-1' })).failed).toBe(true);
    expect((await tools.call('filing_list', {})).failed).toBe(true);
  });
});

describe('the filing_summary tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(filingSummaryTool.name).toBe('filing_summary');
    expect(filingSummaryTool.input).toBe(SummaryInput);
    expect(filingSummaryTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call answers one page of the stored selected companies\' summaries', async () => {
    const tools = await connectTools(filingTools, db);

    const outcome = await tools.call('filing_summary', {});

    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({
      items: [{ cik: APPLE_CIK, ticker: 'AAPL', counts: { '10-K': 1, '10-Q': 0, '8-K': 0, total: 1 }, latest10K: { filingDate: '2026-11-03' } }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
  });

  test('a call writes the flow\'s line under the Filings domain', async () => {
    const captured = captureLog();
    const tools = await connectTools(filingTools, db, captured.log);

    await tools.call('filing_summary', { form: '10-K' });

    expect(captured.records).toHaveLength(1);
    expect(captured.records[0]).toMatchObject({ domain: DOMAIN, scope: 'summary', step: 'read', level: 'debug' });
  });

  test('a call with a stray argument is refused', async () => {
    const tools = await connectTools(filingTools, untouchableDb());
    const outcome = await tools.call('filing_summary', { extra: 1 });
    expect(outcome.failed).toBe(true);
  });
});
