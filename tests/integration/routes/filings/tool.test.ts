import type { TestDatabase } from '../../../support/test-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DOMAIN } from '../../../../src/routes/filings/contract.ts';
import { filingTools } from '../../../../src/routes/filings/tool.ts';
import { FIXED_FILINGS } from '../../../routes/fixtures.ts';
import { captureLog } from '../../../support/capture-log.ts';
import { openTestDatabase } from '../../../support/test-db.ts';
import { connectTools } from '../../../support/tool-harness.ts';

import { APPLE_CIK, seedFilings } from './seeded-db.ts';

let database: TestDatabase;

beforeAll(async () => {
  database = await openTestDatabase();
  await seedFilings(database);
});

afterAll(async () => {
  await database.close();
});

describe('the filing_list tool', () => {
  test('a call answers the stored company and one page of its stored filings', async () => {
    const tools = await connectTools(filingTools, database.db);
    const outcome = await tools.call('filing_list', { ticker: 'aapl', pageSize: 1 });
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({
      company: { cik: APPLE_CIK, ticker: 'AAPL', name: 'Apple Inc.' },
      filings: { items: FIXED_FILINGS.slice(0, 1), page: 1, pageSize: 1, total: FIXED_FILINGS.length },
    });
  });

  test('a call for a ticker no company trades under fails', async () => {
    const tools = await connectTools(filingTools, database.db);
    const outcome = await tools.call('filing_list', { ticker: 'NOPE' });
    expect(outcome).toEqual({ failed: true, body: { error: { name: 'NotFoundError', message: 'company NOPE does not exist' } } });
  });

  test('a call writes the flow\'s line under the Filings domain, which tool.ts binds', async () => {
    const captured = captureLog();
    const tools = await connectTools(filingTools, database.db, captured.log);

    await tools.call('filing_list', { ticker: 'AAPL' });

    expect(captured.records).toHaveLength(1);
    expect(captured.records[0]).toMatchObject({ domain: DOMAIN, scope: 'list', step: 'read', level: 'debug' });
    expect(DOMAIN).toBe('Filings');
  });
});

describe('the filing_summary tool', () => {
  test('a call answers one page of the stored selected companies\' summaries', async () => {
    const tools = await connectTools(filingTools, database.db);

    const outcome = await tools.call('filing_summary', {});

    expect(outcome.failed).toBe(false);
    expect(outcome.body).toMatchObject({
      items: [{ cik: APPLE_CIK, ticker: 'AAPL', counts: { '10-K': 1, '10-Q': 0, '8-K': 0, '6-K': 0, '4': 0, '144': 0, other: 0, total: 1 }, latest10K: { filingDate: '2026-11-03' } }],
      page: 1,
      pageSize: 25,
      total: 1,
    });
  });

  test('a call writes the flow\'s line under the Filings domain', async () => {
    const captured = captureLog();
    const tools = await connectTools(filingTools, database.db, captured.log);

    await tools.call('filing_summary', { form: '10-K' });

    expect(captured.records).toHaveLength(1);
    expect(captured.records[0]).toMatchObject({ domain: DOMAIN, scope: 'summary', step: 'read', level: 'debug' });
  });
});
