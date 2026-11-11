import { describe, expect, test } from 'bun:test';
import { getTableColumns, is } from 'drizzle-orm';
import { getTableConfig as getPgTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { getTableConfig as getSqliteTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import postgres from 'postgres';

import { migratePg } from '../../src/data/migrate.ts';
import * as pgDialect from '../../src/data/pg/index.ts';
import * as sqliteDialect from '../../src/data/sqlite/index.ts';
import { describePg, testPgUrl } from '../support/pg-gate.ts';
import { openMigratedMemoryDb } from '../support/sqlite-db.ts';

/** The tables the service ships: the auth tables, the app-config key/value table and `companies`. */
const EXPECTED_TABLES = ['api_token', 'app_config', 'auth_session', 'companies'];

describe('sqlite schema against a migrated :memory: database', () => {
  const tables = Object.values<unknown>(sqliteDialect).filter((value): value is SQLiteTable => is(value, SQLiteTable));

  test('exports exactly the auth tables, the app-config table and companies', () => {
    expect(tables.map((table) => getSqliteTableConfig(table).name).sort()).toEqual(EXPECTED_TABLES);
  });

  test('every exported table exists with every column it declares', () => {
    const db = openMigratedMemoryDb();
    try {
      for (const table of tables) {
        const { name } = getSqliteTableConfig(table);
        const rows = db.$client.query(`PRAGMA table_info("${name}")`).all() as { name: string }[];
        const declared = Object.values(getTableColumns(table)).map((column) => column.name);
        expect(rows.map((row) => row.name).sort()).toEqual([...declared].sort());
      }
    } finally {
      db.$client.close();
    }
  });
});

describePg('pg schema against a migrated database on TEST_PG_URL', () => {
  test('every exported table exists with every column it declares', async () => {
    const tables = Object.values<unknown>(pgDialect).filter((value): value is PgTable => is(value, PgTable));
    expect(tables.map((table) => getPgTableConfig(table).name).sort()).toEqual(EXPECTED_TABLES);

    const databaseName = `schema_tables_${crypto.randomUUID().replaceAll('-', '')}`;
    const withDatabase = (name: string) => {
      const url = new URL(testPgUrl());
      url.pathname = `/${name}`;
      return url.toString();
    };
    const admin = postgres(testPgUrl(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    const scratch = postgres(withDatabase(databaseName), { max: 1, onnotice: () => {} });
    try {
      await migratePg(drizzlePg(scratch) as Parameters<typeof migratePg>[0]);
      for (const table of tables) {
        const { name, schema } = getPgTableConfig(table);
        const rows = await scratch`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = ${schema ?? 'public'} AND table_name = ${name}`;
        const declared = Object.values(getTableColumns(table)).map((column) => column.name);
        expect(rows.map((row) => row.column_name as string).sort()).toEqual([...declared].sort());
      }
    } finally {
      await scratch.end();
      await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
