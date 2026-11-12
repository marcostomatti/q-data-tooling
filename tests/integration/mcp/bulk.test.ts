import type { Db } from '../../../src/data/repositories/db.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { appConfig } from '../../../src/data/active.ts';
import { BulkItemError, ConflictError, describeError, NotFoundError } from '../../../src/errors.ts';
import { inOneTransaction } from '../../../src/mcp/bulk.ts';
import { thrownBy } from '../../data/rolled-back.ts';
import { openTestDatabase } from '../../support/test-db.ts';
import { openTransactions } from '../data/scratch.ts';

let database: TestDatabase;

beforeAll(async () => {
  database = await openTestDatabase();
});

beforeEach(async () => {
  await database.reset();
});

afterAll(async () => {
  await database.close();
});

/** The `app_config` keys stored under `prefix`, read with SQL, so a test can see which items were committed. */
async function titlesStored(prefix: string): Promise<string[]> {
  const rows = await database.sql<{ key: string }[]>`select key from app_config where key like ${`${prefix}%`}`;
  return rows.map((row) => row.key);
}

/**
 * The transaction that wrote each `app_config` row under `prefix`, by key: Postgres's `xmin`
 * system column, the id of the transaction that inserted the row.
 */
async function writersOf(prefix: string): Promise<string[]> {
  const rows = await database.sql<{ writer: string }[]>`select xmin::text as writer from app_config where key like ${`${prefix}%`} order by key`;
  return rows.map((row) => row.writer);
}

/** Writes one `app_config` row keyed by the item, a table every install has. */
async function writeOne(tx: Db, title: string): Promise<string> {
  await tx.insert(appConfig).values({ key: title, value: true });
  return title;
}

describe('inOneTransaction', () => {
  test('returns each item\'s result in the order the items were given', async () => {
    const results = await inOneTransaction(database.db, ['ok-b', 'ok-a'], (tx, title) => writeOne(tx, title));

    expect(results).toEqual(['ok-b', 'ok-a']);
    expect((await titlesStored('ok-')).sort()).toEqual(['ok-a', 'ok-b']);
  });

  test.each([
    ['a conflict', () => new ConflictError('thing', 'k')],
    ['a missing row', () => new NotFoundError('thing', 3)],
  ])('treats %s as a fault of the item', async (_label, makeFault) => {
    const failure = await thrownBy(() => inOneTransaction(database.db, [0], async () => {
      throw makeFault();
    }));

    expect(failure).toBeInstanceOf(BulkItemError);
    expect(failure).toMatchObject({ index: 0 });
  });

  test('runs every item inside one transaction on the database it was given, and closes it', async () => {
    await inOneTransaction(database.db, ['one-a', 'one-b', 'one-c'], (tx, title) => writeOne(tx, title));

    const writers = await writersOf('one-');
    expect(writers).toHaveLength(3);
    expect(new Set(writers).size).toBe(1);
    expect(await openTransactions(database.url)).toBe(0);
  });

  test('control: the same writes made outside it come from a transaction each, so the test above could have failed', async () => {
    for (const title of ['own-a', 'own-b', 'own-c']) await writeOne(database.db, title);

    expect(new Set(await writersOf('own-')).size).toBe(3);
  });

  test('an empty list returns an empty list without calling the per-item function', async () => {
    let called = 0;

    const results = await inOneTransaction(database.db, [], async () => {
      called += 1;
    });

    expect(results).toEqual([]);
    expect(called).toBe(0);
  });
});

// The rollback cases, on the active dialect's `transact`: a failing item leaves none of the batch stored.
describe('inOneTransaction rollback on Postgres', () => {
  test('raises a BulkItemError with the failing index and the real cause, and writes none of the batch', async () => {
    const failure = await thrownBy(() => inOneTransaction(database.db, ['half-0', 'half-1', 'half-2'], async (tx, title, index) => {
      await writeOne(tx, title);
      if (index === 1) throw new NotFoundError('widget', 7);
    }));

    expect(failure).toBeInstanceOf(BulkItemError);
    expect(failure).toMatchObject({ index: 1, cause: expect.any(NotFoundError) });
    expect(await titlesStored('half-')).toEqual([]);
  });

  test('rethrows a fault that is not about the item unchanged, and still writes none of the batch', async () => {
    const outage = new Error('connection lost');

    const failure = await thrownBy(() => inOneTransaction(database.db, ['out-0', 'out-1'], async (tx, title, index) => {
      await writeOne(tx, title);
      if (index === 1) throw outage;
    }));

    expect(failure).toBe(outage);
    expect(await titlesStored('out-')).toEqual([]);
  });

  test('a BulkItemError from an item is wrapped with this level\'s index and keeps the inner one on its cause', async () => {
    const inner = new BulkItemError(0, new NotFoundError('route', 9));

    const failure = await thrownBy(() => inOneTransaction(database.db, ['nest-0', 'nest-1', 'nest-2'], async (tx, title, index) => {
      await writeOne(tx, title);
      if (index === 2) throw inner;
    }));

    expect(failure).toBeInstanceOf(BulkItemError);
    expect(failure).toMatchObject({ index: 2, cause: inner });
    // describeError adds one level of cause, so the inner reason itself stays on `cause` only.
    expect(describeError(failure).message).toBe('bulk item 2 failed: bulk item 0 failed');
    expect(await titlesStored('nest-')).toEqual([]);
  });

  test('a bulk call inside an item rolls back with the batch around it', async () => {
    const failure = await thrownBy(() => inOneTransaction(database.db, ['deep-0', 'deep-1'], async (tx, title, index) => {
      await inOneTransaction(tx, [`${title}-a`, `${title}-b`], (inner, name) => writeOne(inner, name));
      if (index === 1) throw new NotFoundError('widget', 8);
    }));

    expect(failure).toMatchObject({ index: 1 });
    expect(await titlesStored('deep-')).toEqual([]);
  });
});
