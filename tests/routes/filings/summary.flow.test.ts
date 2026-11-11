import type { CompanySummary } from '../../../src/routes/filings/contract.ts';
import type { SummaryQuery, SummarySlice } from '../../../src/routes/filings/summary.flow.ts';

import { describe, expect, test } from 'bun:test';

import { inDomain } from '../../../src/logging.ts';
import { summarizeFilings } from '../../../src/routes/filings/summary.flow.ts';
import { captureLog } from '../../support/capture-log.ts';

/** One company's summary, as the store answers it. */
const SUMMARY: CompanySummary = {
  cik: 320193,
  ticker: 'AAPL',
  name: 'Apple Inc.',
  counts: { '10-K': 1, '10-Q': 0, '8-K': 0, total: 1 },
  latest10K: null,
  filingsSyncedAt: null,
};

/** A fake store that answers a fixed slice and keeps every query it was asked. */
function fakeStore(slice: SummarySlice): { store: { summary(query: SummaryQuery): Promise<SummarySlice> }; asked: SummaryQuery[] } {
  const asked: SummaryQuery[] = [];
  return {
    asked,
    store: {
      async summary(query) {
        asked.push(query);
        return slice;
      },
    },
  };
}

describe('summarizeFilings flow, called with no transport', () => {
  test('turns page and pageSize into the window the store reads, and passes the form through', async () => {
    const { store, asked } = fakeStore({ items: [], total: 0 });

    await summarizeFilings({ page: 2, pageSize: 4, form: '8-K' }, { filings: store, log: captureLog().log });

    expect(asked).toEqual([{ form: '8-K', offset: 4, limit: 4 }]);
  });

  test('answers the store\'s summaries with the page asked for and the total of every match', async () => {
    const items = [SUMMARY];
    const { store } = fakeStore({ items, total: 7 });

    const page = await summarizeFilings({ page: 1, pageSize: 25 }, { filings: store, log: captureLog().log });

    expect(page).toEqual({ items: [...items], page: 1, pageSize: 25, total: 7 });
  });

  test('scopes its one line at summary and writes it at debug with step read, carrying the domain bound above', async () => {
    const captured = captureLog();
    const { store } = fakeStore({ items: [], total: 0 });

    await summarizeFilings({ page: 1, pageSize: 25 }, { filings: store, log: inDomain(captured.log, 'Filings') });

    expect(captured.records).toEqual([
      { domain: 'Filings', scope: 'summary', step: 'read', page: 1, pageSize: 25, total: 0, level: 'debug', msg: 'filings summarized' },
    ]);
  });
});
