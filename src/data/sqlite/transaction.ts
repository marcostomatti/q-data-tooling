import type { Db } from '../repositories/db.ts';

import { AsyncLocalStorage } from 'node:async_hooks';

import { Database } from 'bun:sqlite';

/**
 * The transaction open in the current async context: its connection, and how many savepoints
 * deep the running body is.
 */
interface OpenTransaction {
  readonly client: Database
  readonly depth: number
}

const current = new AsyncLocalStorage<OpenTransaction>();

/** The last transaction queued on each connection, settled either way, so the next one waits for it. */
const queues = new WeakMap<Database, Promise<unknown>>();

/** The drizzle client was wrapped or replaced, so there is no connection to open a transaction on. */
export class MissingSqliteClientError extends Error {
  constructor() {
    super('transact needs the drizzle client itself (its `$client` is the SQLite connection), not a wrapper of it');
    this.name = 'MissingSqliteClientError';
  }
}

function clientOf(db: Db): Database {
  const client: unknown = Reflect.get(db, '$client');
  if (!(client instanceof Database)) throw new MissingSqliteClientError();
  return client;
}

/** Runs `work` after all the work queued before it on `client` has settled. */
function queued<R>(client: Database, work: () => Promise<R>): Promise<R> {
  const previous = queues.get(client) ?? Promise.resolve();
  const result = previous.then(work);
  queues.set(client, result.then(() => undefined, () => undefined));
  return result;
}

async function inTransaction<R>(client: Database, db: Db, body: (tx: Db) => Promise<R>): Promise<R> {
  client.run('BEGIN IMMEDIATE');
  try {
    const result = await current.run({ client, depth: 0 }, () => body(db));
    client.run('COMMIT');
    return result;
  } catch (error: unknown) {
    // SQLite ends the transaction itself on some errors (a full disk, an interrupt), and a
    // ROLLBACK with none open would throw over the error that matters.
    if (client.inTransaction) client.run('ROLLBACK');
    throw error;
  }
}

async function inSavepoint<R>(open: OpenTransaction, db: Db, body: (tx: Db) => Promise<R>): Promise<R> {
  const depth = open.depth + 1;
  const name = `transact_${depth}`;
  open.client.run(`SAVEPOINT ${name}`);
  try {
    const result = await current.run({ client: open.client, depth }, () => body(db));
    open.client.run(`RELEASE ${name}`);
    return result;
  } catch (error: unknown) {
    if (open.client.inTransaction) {
      open.client.run(`ROLLBACK TO ${name}`);
      open.client.run(`RELEASE ${name}`);
    }
    throw error;
  }
}

/**
 * Runs `body` in one transaction on SQLite: every write it makes commits when it resolves, and
 * none does when it rejects.
 *
 * drizzle's own `db.transaction` cannot do this here. The bun:sqlite driver runs the callback
 * inside bun:sqlite's synchronous `transaction()`, so an async callback hands back its promise at
 * its first `await`, the transaction commits there, and every later statement runs on its own.
 * This function issues `BEGIN IMMEDIATE`, `COMMIT` and `ROLLBACK` itself, around the awaited body.
 *
 * - One at a time: calls on the same connection queue, so two bodies never share one transaction.
 * - Nested: a call made inside a running body (on `tx`) is a savepoint, so its failure rolls back
 *   its own writes only, and the outer body decides about the rest.
 * - `tx` is the same client as `db`: SQLite has one connection, so its open transaction is the
 *   connection's.
 *
 * The limit: a statement that another request runs on the same connection while this body
 * awaits joins the open transaction, and a rollback drops it after that request has answered.
 * It takes two requests in the same tick and a failing body. Keep the body to database work
 * (await nothing slower, such as a network call), so the window stays that small. A queue that
 * every statement passes through closes it, and belongs to the database adapter.
 */
export function transact<R>(db: Db, body: (tx: Db) => Promise<R>): Promise<R> {
  let client: Database;
  try {
    client = clientOf(db);
  } catch (error: unknown) {
    return Promise.reject(error);
  }
  const open = current.getStore();
  if (open?.client === client) return inSavepoint(open, db, body);
  return queued(client, () => inTransaction(client, db, body));
}
