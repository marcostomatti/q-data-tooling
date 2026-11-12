import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getTableColumns, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

import * as pgDialect from '../../../src/data/pg/index.ts';
import { openTestDatabase } from '../../support/test-db.ts';

/** The tables the service ships: the auth tables, the app-config key/value table, `companies`, `company_tickers` and `filings`. */
const EXPECTED_TABLES = ['api_token', 'app_config', 'auth_session', 'companies', 'company_tickers', 'filings'];

describe('pg schema against a migrated scratch database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  test('every exported table exists with every column it declares', async () => {
    const tables = Object.values<unknown>(pgDialect).filter((value): value is PgTable => is(value, PgTable));
    expect(tables.map((table) => getTableConfig(table).name).sort()).toEqual(EXPECTED_TABLES);

    for (const table of tables) {
      const { name, schema } = getTableConfig(table);
      const rows = await database.sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${schema ?? 'public'} AND table_name = ${name}`;
      const declared = Object.values(getTableColumns(table)).map((column) => column.name);
      expect(rows.map((row) => row.column_name).sort()).toEqual([...declared].sort());
    }
  });
});
