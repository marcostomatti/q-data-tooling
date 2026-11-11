import type { Db } from '../data/repositories/db.ts';

import { transact } from '../data/active.ts';
import { isItemFault } from '../data/repositories/item-fault.ts';
import { BulkItemError } from '../errors.ts';

/** What `inOneTransaction` needs besides its arguments. */
export interface BulkDeps {
  /** Runs a body in one transaction on the client it is given, as each dialect's `transact` does. */
  readonly transact: <R>(db: Db, body: (tx: Db) => Promise<R>) => Promise<R>
}

/** The default: the active dialect's `transact`, the one `#db` names. */
const ACTIVE_DIALECT: BulkDeps = { transact };

/**
 * Runs `perItem` over every item inside ONE transaction, in order, and returns the results in the
 * same order. It is the bulk form of a tool that has no bulk repository function, because what it
 * composes (an update and then a move, say) is the tool's own decision.
 *
 * The first item that fails stops the call and rolls everything before it back, so a half-written
 * batch is never left behind. A fault about the item (`isItemFault`, the same predicate
 * a bulk repository function uses) becomes a `BulkItemError` naming the item's index with the real reason as
 * its cause; any other error, such as a lost connection, is rethrown unchanged.
 *
 * A `BulkItemError` thrown by `perItem` itself, because an item is made of a bulk call of its
 * own, counts as an item fault too. It is wrapped with this level's index and keeps the inner
 * one on its cause, so each index belongs to the level that reported it. Left unwrapped, the
 * caller would read the inner index as the outer one, which is wrong in the one field a bulk
 * failure exists to communicate. The message then reads "bulk item 2 failed: bulk item 0
 * failed: route 9 does not exist".
 *
 * `perItem` receives the transaction as its `Db`, so every repository call it makes joins the
 * same transaction. This function only manages that transaction, through `deps.transact`, which
 * rolls back on SQLite as well as on Postgres; it touches no table.
 *
 * `deps.transact` is the active dialect's `transact` unless the caller passes another. Each
 * dialect's `transact` takes only that dialect's client: the SQLite one refuses a client whose
 * `$client` is not a SQLite connection. So a caller that hands in a client of a dialect other
 * than the active one, as a Postgres test does under the default SQLite build, passes that
 * dialect's `transact` as well, and passes it on to any bulk call nested inside an item.
 */
export async function inOneTransaction<I, R>(
  db: Db,
  items: readonly I[],
  perItem: (tx: Db, item: I, index: number) => Promise<R>,
  deps: BulkDeps = ACTIVE_DIALECT,
): Promise<R[]> {
  return deps.transact(db, async (tx) => {
    const results: R[] = [];
    for (const [index, item] of items.entries()) {
      try {
        results.push(await perItem(tx, item, index));
      } catch (error: unknown) {
        throw isItemFault(error) || error instanceof BulkItemError
          ? new BulkItemError(index, error)
          : error;
      }
    }
    return results;
  });
}
