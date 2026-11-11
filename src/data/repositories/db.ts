import type { ActiveClient } from '../active.ts';

/**
 * What every repository function takes as its first argument: the active dialect's
 * process-wide client, or an open transaction on it.
 *
 * It is a structural `Pick` rather than a union with the transaction type: a transaction
 * exposes the same verbs with the same signatures, so it satisfies this type without
 * spelling out the dialect's transaction type and its type parameters, and the compiler
 * states which verbs the repository layer uses. `delete` is there for a write that
 * removes a set of rows, such as the expired sessions. `transaction` is there because the
 * Postgres `transact` calls it. Code never calls `db.transaction` itself: make a multi-statement
 * write atomic with `transact(db, body)` from `src/data/active.ts`. On SQLite, drizzle's
 * `transaction` commits an async callback at its first `await`, so nothing after it rolls back;
 * `transact` rolls back on both dialects, and called inside a running body it opens a savepoint,
 * which is what lets one repository compose another. The lint rule
 * `template/no-drizzle-transaction` fails on any other call of drizzle's `transaction`
 * under `src/`.
 */
export type Db = Pick<ActiveClient, 'select' | 'insert' | 'update' | 'delete' | 'transaction'>;
