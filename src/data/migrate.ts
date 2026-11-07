/**
 * The migrator behind `bun run db:migrate`: applies the active dialect's migrations from
 * `drizzle/<sqlite|pg>/` to the database `DATABASE_URL` names, and reports how many it applied.
 *
 * drizzle-kit's own `migrate` is not used, because it cannot open SQLite through `bun:sqlite`.
 * drizzle-orm's migrators are, one per dialect, and both record each applied migration as one
 * row of `__drizzle_migrations` (in the `drizzle` schema on Postgres). A migration already
 * recorded there is skipped, so a second run against the same database applies nothing. The
 * count each function returns is read from that table before and after the run, not assumed.
 *
 * @module
 */

import type { ActiveClient } from './active.ts';
import type { DrizzleClient as PgClient } from './pg/client.ts';
import type { DrizzleClient as SqliteClient } from './sqlite/client.ts';

import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { migrate as migrateBunSqlite } from 'drizzle-orm/bun-sqlite/migrator';
import { migrate as migratePostgresJs } from 'drizzle-orm/postgres-js/migrator';

import { inDomain, lazyLogger, scoped, type Log } from '../logging.ts';

import { closeDb, DIALECT, getDb } from './active.ts';
import { faultCode } from './driver-faults.ts';

/** A dialect that has a migrations folder under `drizzle/`. */
export type MigrationDialect = 'sqlite' | 'pg';

/** The table drizzle-orm's migrators record applied migrations in, on both dialects. */
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/** The Postgres schema that holds {@link MIGRATIONS_TABLE}, drizzle-orm's default. */
export const PG_MIGRATIONS_SCHEMA = 'drizzle';

/** The repository root, where `drizzle/` lives, whatever the working directory is. */
const REPOSITORY_ROOT = join(import.meta.dir, '..', '..');

/**
 * The folder drizzle-kit writes a dialect's migrations to, as `drizzle.config.ts` names it.
 *
 * @param dialect - The dialect, `sqlite` or `pg`.
 * @returns The absolute path of `drizzle/<dialect>/`.
 */
export function migrationsFolderFor(dialect: MigrationDialect): string {
  return join(REPOSITORY_ROOT, 'drizzle', dialect);
}

/** How many migrations a SQLite database records as applied; 0 when it has no record table. */
function appliedSqliteCount(db: SqliteClient): number {
  const client = db.$client;
  const table = client
    .query<{ name: string }, [string]>('select name from sqlite_master where type = \'table\' and name = ?')
    .get(MIGRATIONS_TABLE);
  if (table === null) return 0;
  const row = client.query<{ count: number }, []>(`select count(*) as count from ${MIGRATIONS_TABLE}`).get();
  return row?.count ?? 0;
}

/**
 * Applies to a SQLite database every migration in `folder` it has not recorded yet.
 *
 * @param db - A Drizzle client on `bun:sqlite`.
 * @param folder - The migrations folder. Defaults to `drizzle/sqlite/`.
 * @returns How many migrations this run applied: 0 when the database was up to date.
 */
export function migrateSqlite(db: SqliteClient, folder: string = migrationsFolderFor('sqlite')): number {
  const before = appliedSqliteCount(db);
  migrateBunSqlite(db, { migrationsFolder: folder });
  return appliedSqliteCount(db) - before;
}

/** How many migrations a Postgres database records as applied; 0 when it has no record table. */
async function appliedPgCount(db: PgClient): Promise<number> {
  const qualified = `${PG_MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const [found] = await db.execute<{ present: boolean }>(sql`select to_regclass(${qualified}) is not null as present`);
  if (found?.present !== true) return 0;
  const [row] = await db.execute<{ count: string }>(
    sql`select count(*) as count from ${sql.identifier(PG_MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  return Number(row?.count ?? 0);
}

/**
 * Applies to a Postgres database every migration in `folder` it has not recorded yet.
 *
 * @param db - A Drizzle client on `postgres-js`.
 * @param folder - The migrations folder. Defaults to `drizzle/pg/`.
 * @returns How many migrations this run applied: 0 when the database was up to date.
 */
export async function migratePg(db: PgClient, folder: string = migrationsFolderFor('pg')): Promise<number> {
  const before = await appliedPgCount(db);
  await migratePostgresJs(db, { migrationsFolder: folder });
  return (await appliedPgCount(db)) - before;
}

/**
 * Applies the active dialect's migrations (see `active.ts`) from `drizzle/<dialect>/`.
 *
 * The client is the active dialect's, and the branch taken is decided by the same `DIALECT`,
 * so the casts below only restate, for the compiler, what that pairing already guarantees.
 *
 * @param db - The active dialect's client. Defaults to the process-wide one.
 * @returns How many migrations this run applied.
 */
export async function migrateActive(db: ActiveClient = getDb()): Promise<number> {
  // Widened, or the build where `DIALECT` is the other literal rejects the comparison below.
  const dialect = DIALECT as MigrationDialect;
  if (dialect === 'sqlite') return migrateSqlite(db as unknown as SqliteClient);
  return migratePg(db as unknown as PgClient);
}

const defaultLogger = lazyLogger('migrate');

/** The domain every line of the database scripts carries. */
const DOMAIN = 'Db';

/** What {@link migrateCommand} runs with; a test passes its own, and each defaults to the real one. */
export type MigrateCommandDeps = {
  /** Applies the migrations and returns how many it applied. Defaults to {@link migrateActive}. */
  readonly migrate?: () => Promise<number>
  /** Closes the database once the run is over. Defaults to `closeDb` of `active.ts`. */
  readonly close?: () => Promise<void>
  /** The base log; the command binds `domain` and `scope` on it. Defaults to the `migrate` logger. */
  readonly log?: Log
};

/**
 * `bun run db:migrate`: migrates the database `DATABASE_URL` names and logs the count, signed
 * `Db:migrate`. A failure is logged by its driver code (see `driver-faults.ts`) and exits 1.
 *
 * @param deps - What the command runs with; every field has a real default.
 * @returns The process exit code: 0 on success, 1 on a failure.
 */
export async function migrateCommand(deps: MigrateCommandDeps = {}): Promise<number> {
  const log = scoped(inDomain(deps.log ?? defaultLogger(), DOMAIN), 'migrate');
  try {
    const applied = await (deps.migrate ?? migrateActive)();
    log.info({ step: 'apply', dialect: DIALECT, applied }, applied === 0
      ? 'database already up to date'
      : 'applied migrations');
    return 0;
  } catch (error) {
    // By code, never by message: a driver's message can repeat a statement or the URL.
    log.error({ step: 'apply', dialect: DIALECT, code: faultCode(error) }, 'migration failed');
    return 1;
  } finally {
    await (deps.close ?? closeDb)();
  }
}

if (import.meta.main) {
  process.exitCode = await migrateCommand();
}
