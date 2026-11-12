import type { Db } from '../../../src/data/repositories/db.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { appConfig, transact } from '../../../src/data/active.ts';
import { openTestDatabase } from '../../support/test-db.ts';

import { openTransactions } from './scratch.ts';

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

/** The `app_config` keys stored under `prefix`, sorted, read with SQL so the check sees what was committed. */
async function keysStored(prefix: string): Promise<string[]> {
  const rows = await database.sql<{ key: string }[]>`select key from app_config where key like ${`${prefix}%`}`;
  return rows.map((row) => row.key).sort();
}

async function writeKey(tx: Db, key: string): Promise<void> {
  await tx.insert(appConfig).values({ key, value: true });
}

describe('transact on Postgres', () => {
  test('commits every write of a body that resolves, and returns its value', async () => {
    const result = await transact(database.db, async (tx) => {
      await writeKey(tx, 'ok-0');
      await writeKey(tx, 'ok-1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(await keysStored('ok-')).toEqual(['ok-0', 'ok-1']);
    expect(await openTransactions(database.url)).toBe(0);
  });

  test('rolls back every write of a body that rejects after several awaits, and rethrows its error', async () => {
    const failure = new Error('item 2 failed');

    await expect(
      transact(database.db, async (tx) => {
        await writeKey(tx, 'half-0');
        await writeKey(tx, 'half-1');
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await keysStored('half-')).toEqual([]);
    expect(await openTransactions(database.url)).toBe(0);
  });

  test('a nested call is a savepoint: its failure rolls back only its own writes', async () => {
    await transact(database.db, async (tx) => {
      await writeKey(tx, 'nest-outer');
      await transact(tx, async (inner) => {
        await writeKey(inner, 'nest-inner');
        throw new Error('inner fails');
      }).catch(() => undefined);
    });

    expect(await keysStored('nest-')).toEqual(['nest-outer']);
  });

  test('a failing outer body rolls back a nested call that succeeded', async () => {
    await expect(
      transact(database.db, async (tx) => {
        await transact(tx, (inner) => writeKey(inner, 'deep-inner'));
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');

    expect(await keysStored('deep-')).toEqual([]);
  });

  test('a call after a failed one still runs', async () => {
    await transact(database.db, async () => {
      throw new Error('first fails');
    }).catch(() => undefined);

    await transact(database.db, (tx) => writeKey(tx, 'after-0'));

    expect(await keysStored('after-')).toEqual(['after-0']);
  });
});
