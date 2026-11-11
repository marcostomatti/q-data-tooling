import type { CompanyListQuery, CompanyListSlice } from '../../../src/routes/companies/list.flow.ts';

import { describe, expect, test } from 'bun:test';

import { inDomain } from '../../../src/logging.ts';
import { listCompanies } from '../../../src/routes/companies/list.flow.ts';
import { STUB_COMPANIES } from '../../../src/routes/companies/stub.ts';
import { captureLog } from '../../support/capture-log.ts';

/** A fake store that answers a fixed slice and keeps every query it was asked. */
function fakeStore(slice: CompanyListSlice): { store: { list(query: CompanyListQuery): Promise<CompanyListSlice> }; asked: CompanyListQuery[] } {
  const asked: CompanyListQuery[] = [];
  return {
    asked,
    store: {
      async list(query) {
        asked.push(query);
        return slice;
      },
    },
  };
}

describe('listCompanies flow, called with no transport', () => {
  test('turns page and pageSize into the window the store reads, and passes the filters through', async () => {
    const { store, asked } = fakeStore({ items: [], total: 0 });

    await listCompanies({ page: 3, pageSize: 10, q: 'ap', selected: true }, { store, log: captureLog().log });

    expect(asked).toEqual([{ q: 'ap', selected: true, offset: 20, limit: 10 }]);
  });

  test('answers the store\'s rows with the page asked for and the total of every match', async () => {
    const { store } = fakeStore({ items: STUB_COMPANIES, total: 42 });

    const page = await listCompanies({ page: 1, pageSize: 25 }, { store, log: captureLog().log });

    expect(page).toEqual({ items: [...STUB_COMPANIES], page: 1, pageSize: 25, total: 42 });
  });

  test('scopes its one line at list and writes it at debug with step read, carrying the domain bound above', async () => {
    const captured = captureLog();
    const { store } = fakeStore({ items: [], total: 0 });

    await listCompanies({ page: 2, pageSize: 5 }, { store, log: inDomain(captured.log, 'Companies') });

    expect(captured.records).toEqual([
      { domain: 'Companies', scope: 'list', step: 'read', page: 2, pageSize: 5, total: 0, level: 'debug', msg: 'companies listed' },
    ]);
  });
});
