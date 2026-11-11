/**
 * `bun run db:status`: compares the active dialect's migrations in `drizzle/<dialect>/` with
 * the rows of `__drizzle_migrations` on the database `DATABASE_URL` names, and prints one line
 * per migration, plus one per row that matches no file.
 *
 * It exists because drizzle-orm 0.45's migrator reads only the newest `created_at` in that table
 * and runs each journal entry whose `when` is later. An entry with an older `when`, such as one
 * a merged branch generated before `main`'s newest migration, is never run, and no error says so
 * (https://github.com/drizzle-team/drizzle-orm/issues/5769, fixed only on the drizzle v1 line,
 * which applies migrations by name; this check goes away with drizzle v1).
 *
 * The states are those of {@link MigrationState}. The command exits 1 when any line is `skipped`
 * or `unknown`, so a gate can run it, and 0 otherwise. {@link classifyMigrations} is a pure
 * function over the journal and the rows, so its rules are tested with no database.
 *
 * @module
 */

import type { ActiveClient } from './active.ts';
import type { MigrationDialect } from './migrate.ts';
import type { DrizzleClient as PgClient } from './pg/client.ts';
import type { DrizzleClient as SqliteClient } from './sqlite/client.ts';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';

import { inDomain, lazyLogger, scoped, type Log } from '../logging.ts';

import { closeDb, DIALECT, getDb } from './active.ts';
import { faultCode } from './driver-faults.ts';
import { MIGRATIONS_TABLE, migrationsFolderFor, PG_MIGRATIONS_SCHEMA } from './migrate.ts';

/**
 * Where a migration stands against `__drizzle_migrations`:
 *
 * - `applied`: its hash is in the table.
 * - `pending`: its hash is not in the table and its `when` is later than the newest
 *   `created_at` (or the table is missing or empty), so the next `db:migrate` runs it.
 * - `skipped`: its hash is not in the table and its `when` is not later than the newest
 *   `created_at`, so drizzle will never run it.
 * - `unknown`: a table row whose hash matches no file, which is what a file edited after it was
 *   applied leaves behind.
 */
export type MigrationState = 'applied' | 'pending' | 'skipped' | 'unknown';

/** One journal entry of a migrations folder, with the hash of its `.sql` file. */
export type JournalMigration = {
  /** The entry's `tag`, the file name without `.sql`, such as `0000_init`. */
  tag: string
  /** The entry's `when`, in milliseconds; drizzle stores it as the row's `created_at`. */
  when: number
  /** The sha256 hex of the file's text, computed as drizzle's `readMigrationFiles` does. */
  hash: string
};

/** One row of `__drizzle_migrations`: the columns the classifier reads. */
export type MigrationRow = {
  /** The hash of the file the migrator applied. */
  hash: string
  /** The applied entry's `when`, in milliseconds. */
  createdAt: number
};

/** One printed line of the status: a journal entry, or a row that matches no file. */
export type StatusLine =
  | { state: Exclude<MigrationState, 'unknown'>, tag: string, when: number }
  | { state: 'unknown', hash: string, createdAt: number };

/**
 * Classifies each journal entry against the table's rows, and adds an `unknown` line for each
 * row whose hash matches no entry. Entries keep the journal's order; `unknown` lines follow.
 *
 * @param migrations - The folder's journal entries with their file hashes, in journal order.
 * @param rows - The rows of `__drizzle_migrations`; none when the table is missing.
 * @returns One line per entry, then one per unmatched row.
 */
export function classifyMigrations(
  migrations: readonly JournalMigration[],
  rows: readonly MigrationRow[],
): StatusLine[] {
  const appliedHashes = new Set(rows.map((row) => row.hash));
  const fileHashes = new Set(migrations.map((migration) => migration.hash));
  const newest = rows.reduce<number | undefined>((max, row) => max === undefined || row.createdAt > max
    ? row.createdAt
    : max, undefined);
  const entries = migrations.map((migration): StatusLine => ({
    state: stateOf(migration, appliedHashes, newest),
    tag: migration.tag,
    when: migration.when,
  }));
  const unknown = rows
    .filter((row) => !fileHashes.has(row.hash))
    .map((row): StatusLine => ({ state: 'unknown', hash: row.hash, createdAt: row.createdAt }));
  return [...entries, ...unknown];
}

/** The state of one journal entry, given the applied hashes and the newest `created_at`. */
function stateOf(
  migration: JournalMigration,
  appliedHashes: ReadonlySet<string>,
  newest: number | undefined,
): Exclude<MigrationState, 'unknown'> {
  if (appliedHashes.has(migration.hash)) return 'applied';
  // The migrator's own test: it runs an entry only when the newest `created_at` is below `when`.
  return newest === undefined || newest < migration.when
    ? 'pending'
    : 'skipped';
}

/**
 * Whether the status calls for action drizzle will not take: any `skipped` or `unknown` line.
 *
 * @param lines - The classifier's lines.
 * @returns The exit code of `db:status`: 1 when such a line exists, 0 otherwise.
 */
export function statusExitCode(lines: readonly StatusLine[]): number {
  return lines.some((line) => line.state === 'skipped' || line.state === 'unknown')
    ? 1
    : 0;
}

/**
 * The text of one status line, such as `applied 0000_init (when 1793971676044)`.
 *
 * @param line - A classifier line.
 * @returns The line, with no trailing newline.
 */
export function formatStatusLine(line: StatusLine): string {
  if (line.state === 'unknown') {
    return `unknown row created_at ${line.createdAt}: hash ${line.hash} matches no migration file`;
  }
  return `${line.state} ${line.tag} (when ${line.when})`;
}

/** The fields of a journal entry this module reads. */
type JournalEntry = { tag: string, when: number };

/**
 * Reads a migrations folder's journal and hashes each entry's `.sql` file. The hash is the
 * sha256 hex of `readFileSync(path).toString()`, as in drizzle's `readMigrationFiles`, with no
 * line-ending or BOM normalisation, so it matches the hash the migrator stored.
 *
 * @param folder - The migrations folder, such as `drizzle/sqlite/`.
 * @returns The entries in journal order, each with its file's hash.
 * @throws When the journal or an entry's file cannot be read.
 */
export function readJournalMigrations(folder: string): JournalMigration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json')).toString()) as {
    entries: JournalEntry[]
  };
  return journal.entries.map((entry) => {
    const text = readFileSync(join(folder, `${entry.tag}.sql`)).toString();
    const hash = createHash('sha256').update(text)
      .digest('hex');
    return { tag: entry.tag, when: entry.when, hash };
  });
}

/**
 * Reads the rows of `__drizzle_migrations` from a SQLite database.
 *
 * @param db - A Drizzle client on `bun:sqlite`.
 * @returns The rows; none when the table does not exist.
 */
export function readSqliteRows(db: SqliteClient): MigrationRow[] {
  const client = db.$client;
  const table = client
    .query<{ name: string }, [string]>('select name from sqlite_master where type = \'table\' and name = ?')
    .get(MIGRATIONS_TABLE);
  if (table === null) return [];
  return client
    .query<{ hash: string, created_at: number | string | null }, []>(`select hash, created_at from ${MIGRATIONS_TABLE}`)
    .all()
    .map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

/**
 * Reads the rows of `drizzle.__drizzle_migrations` from a Postgres database. `created_at` is a
 * bigint, which the driver returns as a string, so it is converted here.
 *
 * @param db - A Drizzle client on `postgres-js`.
 * @returns The rows; none when the table does not exist.
 */
export async function readPgRows(db: PgClient): Promise<MigrationRow[]> {
  const qualified = `${PG_MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const [found] = await db.execute<{ present: boolean }>(sql`select to_regclass(${qualified}) is not null as present`);
  if (found?.present !== true) return [];
  const rows = await db.execute<{ hash: string, created_at: string | number | null }>(
    sql`select hash, created_at from ${sql.identifier(PG_MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  return rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

/**
 * The status of the active dialect's migrations (see `active.ts`) on a database.
 *
 * As in `migrateActive`, the branch taken is decided by `DIALECT`, which also decides the
 * client's type, so the casts below only restate that pairing for the compiler.
 *
 * @param db - The active dialect's client. Defaults to the process-wide one.
 * @param folder - The migrations folder. Defaults to `drizzle/<dialect>/` of the active dialect.
 * @returns The classifier's lines.
 */
export async function migrationStatusActive(
  db: ActiveClient = getDb(),
  folder: string = migrationsFolderFor(DIALECT as MigrationDialect),
): Promise<StatusLine[]> {
  // Widened, or the build where `DIALECT` is the other literal rejects the comparison below.
  const dialect = DIALECT as MigrationDialect;
  const rows = dialect === 'sqlite'
    ? readSqliteRows(db as unknown as SqliteClient)
    : await readPgRows(db as unknown as PgClient);
  return classifyMigrations(readJournalMigrations(folder), rows);
}

const defaultLogger = lazyLogger('db-status');

/** The domain every line of the database scripts carries. */
const DOMAIN = 'Db';

/** What {@link statusCommand} runs with; a test passes its own, and each defaults to the real one. */
export type StatusCommandDeps = {
  /** Reads the status lines. Defaults to {@link migrationStatusActive}. */
  readonly status?: () => Promise<StatusLine[]>
  /** Prints one formatted line, newline included. Defaults to writing to stdout. */
  readonly write?: (text: string) => void
  /** Closes the database once the run is over. Defaults to `closeDb` of `active.ts`. */
  readonly close?: () => Promise<void>
  /** The base log; the command binds `domain` and `scope` on it. Defaults to the `db-status` logger. */
  readonly log?: Log
};

/**
 * `bun run db:status`: prints the status of the database `DATABASE_URL` names, one line per
 * migration. Exits 1 on a `skipped` or `unknown` line, or when the database cannot be read; a
 * read failure is logged, signed `Db:status`, by its driver code (see `driver-faults.ts`), never
 * by its message. The logger is built only when that failure is logged.
 *
 * @param deps - What the command runs with; every field has a real default.
 * @returns The process exit code, {@link statusExitCode}'s, or 1 on a read failure.
 */
export async function statusCommand(deps: StatusCommandDeps = {}): Promise<number> {
  const write = deps.write ?? ((text: string) => void process.stdout.write(text));
  try {
    const lines = await (deps.status ?? (() => migrationStatusActive()))();
    for (const line of lines) write(`${formatStatusLine(line)}\n`);
    return statusExitCode(lines);
  } catch (error) {
    const log = scoped(inDomain(deps.log ?? defaultLogger(), DOMAIN), 'status');
    // By code, never by message: a driver's message can repeat a statement or the URL.
    log.error({ step: 'read', dialect: DIALECT, code: faultCode(error) }, 'migration status failed');
    return 1;
  } finally {
    await (deps.close ?? closeDb)();
  }
}

if (import.meta.main) {
  process.exitCode = await statusCommand();
}
