/**
 * The SQLite test database: a private `:memory:` database with every migration in
 * `drizzle/sqlite/` applied, so a test reads the schema the migrations make and needs no
 * server. Each call opens a database of its own, which ends when it is closed.
 *
 * @module
 */

import type { ActiveClient } from '../../src/data/active.ts';
import type { DrizzleClient } from '../../src/data/sqlite/client.ts';

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { migrateSqlite } from '../../src/data/migrate.ts';
import { MEMORY_DATABASE } from '../../src/data/sqlite/client.ts';

/**
 * The test database's client. It is always a SQLite client, while the functions the tests hand
 * it to are typed for the active dialect (`#db`), so it carries both types and compiles under
 * `bun run typecheck` and `bun run typecheck:pg` alike. It is only true to its type when SQLite
 * is the active dialect.
 */
export type SqliteTestClient = ActiveClient & DrizzleClient;

/**
 * Opens a fresh `:memory:` database and applies the SQLite migrations to it.
 *
 * @returns The client; `client.$client.close()` ends the database.
 */
export function openMigratedMemoryDb(): SqliteTestClient {
  const db = drizzle({ client: new Database(MEMORY_DATABASE) });
  migrateSqlite(db);
  return db as unknown as SqliteTestClient;
}
