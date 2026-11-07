import type { Db } from '../../src/data/repositories/db.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { like } from 'drizzle-orm';

import { appConfig, transact } from '../../src/data/active.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

let db: SqliteTestClient;

beforeEach(() => {
  db = openMigratedMemoryDb();
});

afterEach(() => {
  db.$client.close();
});

/** The `app_config` keys stored under `prefix`, sorted. */
async function keysStored(prefix: string): Promise<string[]> {
  const rows = await db.select({ key: appConfig.key }).from(appConfig)
    .where(like(appConfig.key, `${prefix}%`));
  return rows.map((row) => row.key).sort();
}

async function writeKey(tx: Db, key: string): Promise<void> {
  await tx.insert(appConfig).values({ key, value: true });
}

/** A promise and the function that settles it, so a test can hold a transaction open. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('transact on SQLite', () => {
  test('control: drizzle\'s own transaction commits an async body at its first await', async () => {
    await expect(
      db.transaction(async (tx) => {
        await writeKey(tx, 'ctl-0');
        await writeKey(tx, 'ctl-1');
        throw new Error('too late to roll back');
      }),
    ).rejects.toThrow('too late to roll back');

    expect(await keysStored('ctl-')).toEqual(['ctl-0', 'ctl-1']);
  });

  test('commits every write of a body that resolves, and returns its value', async () => {
    const result = await transact(db, async (tx) => {
      await writeKey(tx, 'ok-0');
      await writeKey(tx, 'ok-1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(await keysStored('ok-')).toEqual(['ok-0', 'ok-1']);
    expect(db.$client.inTransaction).toBe(false);
  });

  test('rolls back every write of a body that rejects after several awaits, and rethrows its error', async () => {
    const failure = new Error('item 2 failed');

    await expect(
      transact(db, async (tx) => {
        await writeKey(tx, 'half-0');
        await writeKey(tx, 'half-1');
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await keysStored('half-')).toEqual([]);
    expect(db.$client.inTransaction).toBe(false);
  });

  test('a nested call is a savepoint: its failure rolls back only its own writes', async () => {
    await transact(db, async (tx) => {
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
      transact(db, async (tx) => {
        await transact(tx, (inner) => writeKey(inner, 'deep-inner'));
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');

    expect(await keysStored('deep-')).toEqual([]);
  });

  test('two calls on one database run one after the other, never interleaved', async () => {
    const order: string[] = [];
    const held = gate();

    const first = transact(db, async (tx) => {
      order.push('first starts');
      await writeKey(tx, 'seq-first');
      await held.opened;
      order.push('first ends');
    });
    const second = transact(db, async (tx) => {
      order.push('second starts');
      await writeKey(tx, 'seq-second');
    });
    await Promise.resolve();
    held.open();
    await Promise.all([first, second]);

    expect(order).toEqual(['first starts', 'first ends', 'second starts']);
    expect(await keysStored('seq-')).toEqual(['seq-first', 'seq-second']);
  });

  test('a call after a failed one still runs', async () => {
    await transact(db, async () => {
      throw new Error('first fails');
    }).catch(() => undefined);

    await transact(db, (tx) => writeKey(tx, 'after-0'));

    expect(await keysStored('after-')).toEqual(['after-0']);
  });

  test('a database without its SQLite client is refused with a reason', async () => {
    const wrapper = { select: db.select.bind(db) } as unknown as Db;

    await expect(transact(wrapper, async () => 'never')).rejects.toThrow(/client/);
  });
});
