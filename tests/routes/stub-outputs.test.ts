import type { SqliteTestClient } from '../support/sqlite-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { CompanyListInput, CompanyListOutput, CompanyUpdateOutput } from '../../src/routes/companies/contract.ts';
import { listCompanies } from '../../src/routes/companies/list.flow.ts';
import { companyStore } from '../../src/routes/companies/repository.ts';
import { companyTools } from '../../src/routes/companies/tool.ts';
import { updateCompany } from '../../src/routes/companies/update.flow.ts';
import { FilingListInput, FilingListOutput, SummaryInput, SummaryOutput } from '../../src/routes/filings/contract.ts';
import { listFilings } from '../../src/routes/filings/list.flow.ts';
import { companyLookupStore, filingStore } from '../../src/routes/filings/repository.ts';
import { summarizeFilings } from '../../src/routes/filings/summary.flow.ts';
import { filingTools } from '../../src/routes/filings/tool.ts';
import { mountRoutes } from '../../src/routes/http.ts';
import { startTestServer, type TestServer } from '../http/harness.ts';
import { captureLog } from '../support/capture-log.ts';
import { connectTools } from '../support/tool-harness.ts';

import { selectOnlyWithSql } from './companies/seeded-db.ts';
import { openSeededFilingsDb } from './filings/seeded-db.ts';

const { log } = captureLog();

/** The seeded companies and filings every route and tool here reads. */
let db: SqliteTestClient;
let server: TestServer;

beforeAll(async () => {
  db = await openSeededFilingsDb();
  server = await startTestServer((app) => mountRoutes(app, db, log));
});

afterAll(async () => {
  await server.close();
  db.$client.close();
});

/** Calls a tool and answers its body once it did not fail. */
async function toolBody(tools: typeof companyTools, name: string, args: Record<string, unknown>): Promise<unknown> {
  const connected = await connectTools(tools, db);
  const outcome = await connected.call(name, args);
  expect(outcome.failed).toBe(false);
  return outcome.body;
}

/** Calls a route and answers the `data` of its 200 envelope. */
async function routeData(method: 'GET' | 'PATCH', path: string, body?: unknown): Promise<unknown> {
  const outcome = await server.request(method, path, body);
  expect(outcome.status).toBe(200);
  expect(outcome.body).toMatchObject({ success: true });
  return (outcome.body as { data: unknown }).data;
}

describe('the output schemas refuse what the stubs must not answer (control)', () => {
  test('a stray field, a missing page and a bad CIK padding are each refused', async () => {
    const page = await listCompanies(CompanyListInput.parse({}), { store: companyStore(db), log });
    expect(CompanyListOutput.safeParse(page).success).toBe(true);
    expect(CompanyListOutput.safeParse({ ...page, extra: 1 }).success).toBe(false);
    expect(CompanyListOutput.safeParse({ items: page.items }).success).toBe(false);
    const broken = { ...page, items: [{ ...page.items[0], cik10: '320193' }] };
    expect(CompanyListOutput.safeParse(broken).success).toBe(false);
  });
});

describe('company_list', () => {
  test('the flow, the tool and the route answer a page that passes CompanyListOutput', async () => {
    const fromFlow = await listCompanies(CompanyListInput.parse({}), { store: companyStore(db), log });
    const fromTool = await toolBody(companyTools, 'company_list', {});
    const fromRoute = await routeData('GET', '/api/companies');
    for (const answer of [fromFlow, fromTool, fromRoute]) {
      expect(CompanyListOutput.parse(answer).items.length).toBeGreaterThan(0);
    }
  });

  test('an empty page passes too', async () => {
    const answer = await listCompanies(CompanyListInput.parse({ q: 'zzzz-no-match' }), { store: companyStore(db), log });
    expect(answer.items).toEqual([]);
    expect(CompanyListOutput.safeParse(answer).success).toBe(true);
  });
});

describe('company_update', () => {
  test('the flow, the tool and the route answer a company that passes CompanyUpdateOutput', async () => {
    const fromFlow = await updateCompany({ ticker: 'AAPL', selected: false }, { store: companyStore(db), log });
    const fromTool = await toolBody(companyTools, 'company_update', { ticker: 'wmt', selected: true });
    const fromRoute = await routeData('PATCH', '/api/companies/wmt', { selected: true });
    expect(CompanyUpdateOutput.parse(fromFlow).selected).toBe(false);
    expect(CompanyUpdateOutput.parse(fromTool).selected).toBe(true);
    expect(CompanyUpdateOutput.parse(fromRoute).selected).toBe(true);
  });
});

describe('filing_list', () => {
  const deps = (): Parameters<typeof listFilings>[1] => ({ companies: companyLookupStore(db), filings: filingStore(db), log });

  test('the flow, the tool and the route answer a company and page that pass FilingListOutput', async () => {
    const fromFlow = await listFilings(FilingListInput.parse({ ticker: 'aapl' }), deps());
    const fromTool = await toolBody(filingTools, 'filing_list', { ticker: 'aapl' });
    const fromRoute = await routeData('GET', '/api/companies/aapl/filings');
    for (const answer of [fromFlow, fromTool, fromRoute]) {
      expect(FilingListOutput.parse(answer).filings.items.length).toBeGreaterThan(0);
    }
  });

  test('a company with no filings answers an empty page that passes', async () => {
    const answer = await listFilings(FilingListInput.parse({ ticker: 'wmt' }), deps());
    expect(answer.filings.items).toEqual([]);
    expect(FilingListOutput.safeParse(answer).success).toBe(true);
  });
});

describe('filing_summary', () => {
  test('the flow, the tool and the route answer a page that passes SummaryOutput', async () => {
    const fromFlow = await summarizeFilings(SummaryInput.parse({}), { filings: filingStore(db), log });
    const fromTool = await toolBody(filingTools, 'filing_summary', {});
    const fromRoute = await routeData('GET', '/api/filings/summary');
    for (const answer of [fromFlow, fromTool, fromRoute]) {
      expect(SummaryOutput.parse(answer).items.length).toBeGreaterThan(0);
    }
  });

  test('a form no selected company filed answers zero counts that pass', async () => {
    const answer = await summarizeFilings(SummaryInput.parse({ form: '8-K' }), { filings: filingStore(db), log });
    expect(answer.items.length).toBeGreaterThan(0);
    for (const summary of answer.items) expect(summary.counts.total).toBe(0);
    expect(SummaryOutput.safeParse(answer).success).toBe(true);
  });

  test('no selected company answers an empty page that passes', async () => {
    selectOnlyWithSql(db, []);
    const answer = await summarizeFilings(SummaryInput.parse({}), { filings: filingStore(db), log });
    expect(answer).toMatchObject({ items: [], total: 0 });
    expect(SummaryOutput.safeParse(answer).success).toBe(true);
  });
});
