import { describe, expect, test } from 'bun:test';
import { getTableName } from 'drizzle-orm';

import * as pg from '../../../src/data/pg/index.ts';
import * as sqlite from '../../../src/data/sqlite/index.ts';

describe('the Postgres dialect folder', () => {
  test('exports the same names as the SQLite one', () => {
    // Act
    const pgNames = Object.keys(pg).sort();
    const sqliteNames = Object.keys(sqlite).sort();

    // Assert
    expect(pgNames).toEqual(sqliteNames);
    expect(pgNames).toEqual(['DIALECT', 'apiToken', 'appConfig', 'authSession', 'closeDb', 'companies', 'companyTickers', 'dbDependency', 'getDb', 'transact']);
    expect([pg.DIALECT, sqlite.DIALECT]).toEqual(['pg', 'sqlite']);
  });

  test('names the same tables as the SQLite schema', () => {
    // Act
    const pgTables = [pg.apiToken, pg.authSession, pg.appConfig, pg.companies, pg.companyTickers].map(getTableName);
    const sqliteTables = [sqlite.apiToken, sqlite.authSession, sqlite.appConfig, sqlite.companies, sqlite.companyTickers].map(getTableName);

    // Assert
    expect(pgTables).toEqual(sqliteTables);
    expect(pgTables).toEqual(['api_token', 'auth_session', 'app_config', 'companies', 'company_tickers']);
  });
});
