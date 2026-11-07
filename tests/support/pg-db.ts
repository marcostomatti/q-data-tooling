/**
 * The Postgres test database: a scratch database created on the server `TEST_PG_URL` names,
 * with every migration in `drizzle/pg/` applied. Use it only inside `describePg`, where the
 * gate guarantees the variable is set; with the gate closed nothing here runs.
 *
 * @module
 */

import type { ActiveClient } from '../../src/data/active.ts';
import type { DrizzleClient } from '../../src/data/pg/client.ts';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { migrationsFolderFor } from '../../src/data/migrate.ts';

import { testPgUrl } from './pg-gate.ts';

/**
 * The scratch database's client. It is always a Postgres client, while the repositories the
 * tests hand it to are typed for the active dialect (`#db`), so it carries both types and
 * compiles under `bun run typecheck` and `bun run typecheck:pg` alike. It is only true to its
 * type when Postgres is the active dialect.
 */
export type PgTestClient = ActiveClient & DrizzleClient;

/** `TEST_PG_URL`'s server and credentials, pointed at another database. */
function urlFor(databaseName: string): string {
  const url = new URL(testPgUrl());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Creates an empty database on the `TEST_PG_URL` server, applies every Postgres migration to
 * it, runs `body` against it and drops it again, whether or not `body` threw. The name is
 * random, so concurrent runs do not collide, and only a database this call created is dropped.
 *
 * @param body - Receives the client, the raw `postgres` handle and the scratch database's URL.
 * @returns What `body` returned.
 * @throws {Error} when `TEST_PG_URL` is unset; call it inside `describePg`.
 */
export async function withMigratedPgDatabase<T>(
  body: (db: PgTestClient, sql: postgres.Sql, url: string) => Promise<T>,
): Promise<T> {
  const name = `scratch_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = postgres(testPgUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const scratch = postgres(urlFor(name), { max: 1, onnotice: () => {} });
    try {
      const db = drizzle(scratch) as unknown as PgTestClient;
      await migrate(db, { migrationsFolder: migrationsFolderFor('pg') });
      return await body(db, scratch, urlFor(name));
    } finally {
      await scratch.end();
      await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
