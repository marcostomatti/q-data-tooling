import type { Db } from '../../src/data/repositories/db.ts';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { like } from 'drizzle-orm';

import { appConfig } from '../../src/data/active.ts';
import { transact as pgTransact } from '../../src/data/pg/transaction.ts';
import { transact as sqliteTransact } from '../../src/data/sqlite/transaction.ts';
import { BulkItemError, ConflictError, describeError, NotFoundError } from '../../src/errors.ts';
import { type BulkDeps, inOneTransaction } from '../../src/mcp/bulk.ts';
import { thrownBy } from '../data/rolled-back.ts';
import { withMigratedPgDatabase } from '../support/pg-db.ts';
import { describePg } from '../support/pg-gate.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

let current: SqliteTestClient | undefined;

beforeAll(() => {
  current = openMigratedMemoryDb();
});

afterAll(() => {
  current?.$client.close();
});

/** The database shared by the tests in this file; they write rows under names of their own. */
function database(): SqliteTestClient {
  if (!current) throw new Error('the shared database is not ready');
  return current;
}

/** The `app_config` keys stored under `prefix`, so a test can see which items survived. */
async function titlesStored(db: Db, prefix: string): Promise<string[]> {
  const rows = await db.select({ key: appConfig.key }).from(appConfig)
    .where(like(appConfig.key, `${prefix}%`));
  return rows.map((row) => row.key);
}

/** Writes one `app_config` row keyed by the item, a table every install has. */
async function writeOne(tx: Db, title: string): Promise<string> {
  await tx.insert(appConfig).values({ key: title, value: true });
  return title;
}

/** Runs `body` on a fresh migrated SQLite database in memory, closed afterwards. */
async function withMemoryDatabase(body: (db: Db) => Promise<void>): Promise<void> {
  const db = openMigratedMemoryDb();
  try {
    await body(db);
  } finally {
    db.$client.close();
  }
}

describe('inOneTransaction', () => {
  test('returns each item\'s result in the order the items were given', async () => {
    const results = await inOneTransaction(database(), ['ok-b', 'ok-a'], (tx, title) => writeOne(tx, title));

    expect(results).toEqual(['ok-b', 'ok-a']);
    expect((await titlesStored(database(), 'ok-')).sort()).toEqual(['ok-a', 'ok-b']);
  });

  test.each([
    ['a conflict', () => new ConflictError('thing', 'k')],
    ['a missing row', () => new NotFoundError('thing', 3)],
  ])('treats %s as a fault of the item', async (_label, makeFault) => {
    const failure = await thrownBy(() => inOneTransaction(database(), [0], async () => {
      throw makeFault();
    }));

    expect(failure).toBeInstanceOf(BulkItemError);
    expect(failure).toMatchObject({ index: 0 });
  });

  test('runs every item inside a transaction open on the database it was given', async () => {
    const open: boolean[] = [];

    await inOneTransaction(database(), ['one-a', 'one-b', 'one-c'], async (tx, title) => {
      open.push(database().$client.inTransaction);
      return writeOne(tx, title);
    });

    expect(open).toEqual([true, true, true]);
    expect(database().$client.inTransaction).toBe(false);
  });

  test('an empty list returns an empty list without calling the per-item function', async () => {
    let called = 0;

    const results = await inOneTransaction(database(), [], async () => {
      called += 1;
    });

    expect(results).toEqual([]);
    expect(called).toBe(0);
  });
});

/**
 * The rollback cases, run on each dialect: a failing item leaves none of the batch stored.
 * `withDatabase` hands each case a migrated database of its own, and `deps` carries the
 * `transact` of that database's dialect. The default is the active dialect's, which is SQLite's
 * under the default build, and the SQLite `transact` refuses a Postgres client.
 */
function rollbackCases(withDatabase: (body: (db: Db) => Promise<void>) => Promise<void>, deps: BulkDeps): void {
  test('raises a BulkItemError with the failing index and the real cause, and writes none of the batch', async () => {
    await withDatabase(async (db) => {
      const failure = await thrownBy(() => inOneTransaction(db, ['half-0', 'half-1', 'half-2'], async (tx, title, index) => {
        await writeOne(tx, title);
        if (index === 1) throw new NotFoundError('widget', 7);
      }, deps));

      expect(failure).toBeInstanceOf(BulkItemError);
      expect(failure).toMatchObject({ index: 1, cause: expect.any(NotFoundError) });
      expect(await titlesStored(db, 'half-')).toEqual([]);
    });
  });

  test('rethrows a fault that is not about the item unchanged, and still writes none of the batch', async () => {
    await withDatabase(async (db) => {
      const outage = new Error('connection lost');

      const failure = await thrownBy(() => inOneTransaction(db, ['out-0', 'out-1'], async (tx, title, index) => {
        await writeOne(tx, title);
        if (index === 1) throw outage;
      }, deps));

      expect(failure).toBe(outage);
      expect(await titlesStored(db, 'out-')).toEqual([]);
    });
  });

  test('a BulkItemError from an item is wrapped with this level\'s index and keeps the inner one on its cause', async () => {
    await withDatabase(async (db) => {
      const inner = new BulkItemError(0, new NotFoundError('route', 9));

      const failure = await thrownBy(() => inOneTransaction(db, ['nest-0', 'nest-1', 'nest-2'], async (tx, title, index) => {
        await writeOne(tx, title);
        if (index === 2) throw inner;
      }, deps));

      expect(failure).toBeInstanceOf(BulkItemError);
      expect(failure).toMatchObject({ index: 2, cause: inner });
      // describeError adds one level of cause, so the inner reason itself stays on `cause` only.
      expect(describeError(failure).message).toBe('bulk item 2 failed: bulk item 0 failed');
      expect(await titlesStored(db, 'nest-')).toEqual([]);
    });
  });

  test('a bulk call inside an item rolls back with the batch around it', async () => {
    await withDatabase(async (db) => {
      const failure = await thrownBy(() => inOneTransaction(db, ['deep-0', 'deep-1'], async (tx, title, index) => {
        await inOneTransaction(tx, [`${title}-a`, `${title}-b`], (inner, name) => writeOne(inner, name), deps);
        if (index === 1) throw new NotFoundError('widget', 8);
      }, deps));

      expect(failure).toMatchObject({ index: 1 });
      expect(await titlesStored(db, 'deep-')).toEqual([]);
    });
  });
}

describe('inOneTransaction rollback on SQLite', () => {
  rollbackCases(withMemoryDatabase, { transact: sqliteTransact });
});

describePg('inOneTransaction rollback on Postgres', () => {
  rollbackCases(withMigratedPgDatabase, { transact: pgTransact });
});
