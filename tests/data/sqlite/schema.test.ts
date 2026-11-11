import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

import * as dialect from '../../../src/data/sqlite/index.ts';
import * as auth from '../../../src/data/sqlite/tables/auth.ts';
import * as companies from '../../../src/data/sqlite/tables/companies.ts';
import * as config from '../../../src/data/sqlite/tables/config.ts';

/** Seconds a default timestamp may lie from the test's own clock, for a slow machine. */
const CLOCK_SLACK_SECONDS = 5;

/** The tables `schema/` declares, created on a fresh `:memory:` database from drizzle-kit's DDL. */
async function migratedMemoryDb(tables: Record<string, unknown>) {
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(tables),
  );
  const sqlite = new Database(':memory:');
  for (const statement of statements) sqlite.run(statement);
  return drizzle({ client: sqlite });
}

function nearNow(date: Date): boolean {
  return Math.abs(date.getTime() - Date.now()) <= CLOCK_SLACK_SECONDS * 1000;
}

let db: Awaited<ReturnType<typeof migratedMemoryDb>>;

beforeEach(async () => {
  db = await migratedMemoryDb({ ...auth, ...companies, ...config });
});

describe('the SQLite schema', () => {
  test('declares only the auth tables, the app-config table, companies and company_tickers', () => {
    const query = 'select name from sqlite_master where type = \'table\' and name not like \'sqlite_%\' order by name';
    const tables = db.$client
      .query<{ name: string }, []>(query)
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(['api_token', 'app_config', 'auth_session', 'companies', 'company_tickers']);
  });

  test('the index exports its dialect, the client, the dependency and the tables', () => {
    expect(dialect.DIALECT).toBe('sqlite');
    expect(Object.keys(dialect).sort()).toEqual([
      'DIALECT',
      'apiToken',
      'appConfig',
      'authSession',
      'closeDb',
      'companies',
      'companyTickers',
      'dbDependency',
      'getDb',
      'transact',
    ]);
  });

  test('auth_session stores timestamps as epoch seconds and defaults created_at to now', () => {
    // Arrange
    const expiresAt = new Date('2030-01-02T03:04:05Z');

    // Act
    db.insert(auth.authSession).values({ idHash: 'abc', expiresAt })
      .run();
    const row = db.select().from(auth.authSession)
      .get();
    const raw = db.$client.query<{ expires_at: number }, []>('select expires_at from auth_session').get();

    // Assert
    expect(row?.expiresAt).toEqual(expiresAt);
    expect(raw?.expires_at).toBe(expiresAt.getTime() / 1000);
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(nearNow(row!.createdAt)).toBe(true);
  });

  test('control: a current_timestamp default reads back as an invalid date, so the now check can fail', async () => {
    // Arrange
    const textDefault = sqliteTable('text_default', {
      id: integer().primaryKey(),
      at: integer({ mode: 'timestamp' }).notNull()
        .default(sql`(current_timestamp)`),
    });
    const control = await migratedMemoryDb({ textDefault });

    // Act
    control.insert(textDefault).values({ id: 1 })
      .run();
    const row = control.select().from(textDefault)
      .get();

    // Assert
    expect(Number.isNaN(row!.at.getTime())).toBe(true);
  });

  test('api_token numbers its rows and refuses a second row with the same hash', () => {
    // Arrange
    const token = { name: 'agent', tokenHash: 'h1', prefix: 'tok_' };

    // Act
    const first = db.insert(auth.apiToken).values(token)
      .returning()
      .get();
    const second = db.insert(auth.apiToken).values({ ...token, tokenHash: 'h2' })
      .returning()
      .get();
    const duplicate = () => db.insert(auth.apiToken).values(token)
      .run();

    // Assert
    expect(second.id).toBe(first.id + 1);
    expect(nearNow(first.createdAt)).toBe(true);
    expect(first.lastUsedAt).toBeNull();
    expect(first.revokedAt).toBeNull();
    expect(duplicate).toThrow(/UNIQUE/);
  });

  test('app_config keeps a JSON value as it was given and stamps updated_at', () => {
    // Arrange
    const value = { enabled: true, keep: 7, folder: 'backups', tags: ['a', null] };

    // Act
    db.insert(config.appConfig).values({ key: 'backup', value })
      .run();
    const row = db.select().from(config.appConfig)
      .where(eq(config.appConfig.key, 'backup'))
      .get();

    // Assert
    expect(row?.value).toEqual(value);
    expect(nearNow(row!.updatedAt)).toBe(true);
  });

  test('companies defaults selected to false and exchanges to [], and leaves the header fields null', () => {
    // Act
    const row = db.insert(companies.companies).values({ cik: 2809, cik10: '0000002809', ticker: 'AEM', name: 'AGNICO EAGLE MINES LTD' })
      .returning()
      .get();
    const raw = db.$client.query<{ selected: number; exchanges: string }, []>('select selected, exchanges from companies').get();

    // Assert
    expect(row.selected).toBe(false);
    expect(raw).toEqual({ selected: 0, exchanges: '[]' });
    expect(row.exchanges).toEqual([]);
    expect([row.sic, row.sicDescription, row.category, row.fiscalYearEnd, row.filingsSyncedAt]).toEqual([null, null, null, null, null]);
  });

  test('companies reads back selected, exchanges and filings_synced_at as given, so the defaults check can fail', () => {
    // Arrange
    const syncedAt = new Date('2026-11-11T10:00:00Z');

    // Act
    db.insert(companies.companies).values({
      cik: 320193, cik10: '0000320193', ticker: 'AAPL', name: 'Apple Inc.', selected: true, exchanges: ['Nasdaq'], filingsSyncedAt: syncedAt,
    })
      .run();
    const row = db.select().from(companies.companies)
      .where(eq(companies.companies.cik, 320193))
      .get();

    // Assert
    expect(row?.selected).toBe(true);
    expect(row?.exchanges).toEqual(['Nasdaq']);
    expect(row?.filingsSyncedAt).toEqual(syncedAt);
  });

  test('companies refuses a second row with the same cik10', () => {
    // Arrange
    db.insert(companies.companies).values({ cik: 2809, cik10: '0000002809', ticker: 'AEM', name: 'AGNICO EAGLE MINES LTD' })
      .run();

    // Act
    const duplicate = () => db.insert(companies.companies).values({ cik: 2810, cik10: '0000002809', ticker: 'X', name: 'X' })
      .run();

    // Assert
    expect(duplicate).toThrow(/UNIQUE/);
  });

  test('companies carries the name and selected indexes', () => {
    // Act
    const indexes = db.$client
      .query<{ name: string }, []>('select name from sqlite_master where type = \'index\' and tbl_name = \'companies\' and name not like \'sqlite_%\' order by name')
      .all()
      .map((row) => row.name);

    // Assert
    expect(indexes).toEqual(['companies_cik10_unique', 'companies_name_idx', 'companies_selected_idx']);
  });

  test('company_tickers resolves a primary and a secondary ticker to the same company', () => {
    // Arrange
    db.insert(companies.companies).values({ cik: 2809, cik10: '0000002809', ticker: 'AEM', name: 'AGNICO EAGLE MINES LTD' })
      .run();
    db.insert(companies.companyTickers).values([{ ticker: 'AEM', cik: 2809 }, { ticker: 'AEMRF', cik: 2809 }])
      .run();

    // Act
    const rows = db.select().from(companies.companyTickers)
      .orderBy(companies.companyTickers.ticker)
      .all();

    // Assert
    expect(rows).toEqual([{ ticker: 'AEM', cik: 2809 }, { ticker: 'AEMRF', cik: 2809 }]);
  });

  test('company_tickers refuses a second row with the same ticker', () => {
    // Arrange
    db.insert(companies.companyTickers).values({ ticker: 'AEM', cik: 2809 })
      .run();

    // Act
    const duplicate = () => db.insert(companies.companyTickers).values({ ticker: 'AEM', cik: 320193 })
      .run();

    // Assert
    expect(duplicate).toThrow(/UNIQUE/);
  });

  test('company_tickers keys cik to companies.cik with a cascading delete', () => {
    // Act
    const keys = db.$client
      .query<{ table: string; from: string; to: string; on_delete: string }, []>('select "table", "from", "to", on_delete from pragma_foreign_key_list(\'company_tickers\')')
      .all();

    // Assert
    expect(keys).toEqual([{ table: 'companies', from: 'cik', to: 'cik', on_delete: 'CASCADE' }]);
  });
});
