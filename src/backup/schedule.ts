import type { BackupSettings } from './contract.ts';
import type { Db } from '../data/repositories/db.ts';

import { readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { createDependency } from '@open-tomato/service-express';

import { closeDb, DIALECT, getDb } from '../data/active.ts';
import { MissingDatabaseUrlError } from '../data/pg/client.ts';
import { BACKUP_DEFAULTS, readBackupSettings } from '../data/repositories/config.ts';
import { InvalidDatabaseUrlError } from '../data/sqlite/client.ts';
import { inDomain, lazyLogger, scoped, type Log } from '../logging.ts';

import { BackupDumpError, type Dumper } from './dump.ts';
import { createPgDumper, type Spawner } from './pg-dump.ts';
import { isBackupFileName, isPartialFileName, parseBackupTime, planRetention, type BackupFile } from './retention.ts';
import { createSqliteDumper } from './sqlite-dump.ts';

/** Where dumps go: `backups/` at the repository root, which `.gitignore` excludes. */
export const DEFAULT_BACKUP_DIR = resolve(import.meta.dir, '../../backups');

const DAY_MS = 86_400_000;

/**
 * How long a partial dump must have gone unwritten before it is swept. A dump in flight is
 * stopped after ten minutes, so a partial untouched for an hour belongs to a process that died.
 * The wait is what keeps a sweep from removing the file another process is writing right now.
 */
const STALE_PARTIAL_MS = 3_600_000;

/**
 * How often the schedule asks whether a backup is due: hourly. The interval itself is in days
 * and is checked against the newest backup on disk, not counted down in a timer, for two
 * reasons. A timer longer than 2^31 - 1 ms (about 24.8 days) fires at once, and a stored
 * interval may be up to 1,000 days. And a countdown restarts with the process, so a service
 * restarted every week would never reach a fortnight; the age of the newest file survives a restart.
 */
const CHECK_EVERY_MS = 3_600_000;

/**
 * What the schedule logs with: a base `Log`, on which the schedule binds its domain and the scope
 * of each entry point, so a capturing fake sees them. The `service-logger` `Logger` satisfies this.
 */
export type BackupLog = Log;

/** The domain every line of the schedule carries. */
const DOMAIN = 'Backup';

/** The timer calls the schedule makes, so a test can see them and run a tick by hand. */
export type BackupTimers = {
  setInterval(run: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
};

/** The dialects a backup can dump. */
export type BackupDialect = 'sqlite' | 'pg';

export type BackupOptions = {
  readonly db: Db
  readonly outDir: string
  /**
   * Which dump to write: SQLite's `VACUUM INTO` or `pg_dump`. Defaults to the active `DIALECT`;
   * a Postgres test passes `'pg'` while SQLite is the active dialect.
   */
  readonly dialect?: BackupDialect
  /** Runs `pg_dump` for the `'pg'` dialect. Defaults to the real one; a test passes a stand-in. */
  readonly spawn?: Spawner
  /**
   * The database to dump. Defaults to `DATABASE_URL`. For Postgres it is a credential and is
   * never logged; for SQLite, unset means the default database file.
   */
  readonly databaseUrl?: string
  readonly now?: () => Date
  /** The base log; the schedule binds `domain` and `scope` on it. Defaults to the `backup` logger. */
  readonly logger?: BackupLog
};

export type BackupScheduleOptions = BackupOptions & { readonly timers?: BackupTimers };

/** What a service passes to run the schedule beside it: the options but for the database, and the directory is optional. */
export type BackupWiring = Omit<BackupScheduleOptions, 'db' | 'outDir'> & {
  readonly outDir?: string
  /** Where the settings are read from. Defaults to the service's own database; a test passes a scratch one. */
  readonly db?: Db
};

export type BackupResult = { readonly path: string; readonly dropped: number };

const defaultLogger = lazyLogger('backup');

/** The default logger with the domain bound, made on first use and reused after. */
let defaultDomainLog: Log | undefined;

/**
 * The schedule's domain logger: the injected base with `domain` bound, or the default one, built
 * once. Each entry point scopes it with {@link scoped}.
 */
function domainLog(logger: BackupLog | undefined): Log {
  if (logger) return inDomain(logger, DOMAIN);
  defaultDomainLog ??= inDomain(defaultLogger(), DOMAIN);
  return defaultDomainLog;
}

const realTimers: BackupTimers = {
  setInterval: (run, ms) => {
    const handle = setInterval(run, ms);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * What a log line says about a failure. A dump failure's message is already free of the URL.
 * Any other error is reduced to its class name, because a driver or file-system message can
 * carry an address, a path or a SQL fragment.
 */
function describeFailure(error: unknown): string {
  if (error instanceof BackupDumpError) return error.message;
  return error instanceof Error
    ? `unexpected ${error.name}`
    : 'unexpected failure';
}

/** The directory's entries, or none when it does not exist yet. */
async function entriesOf(outDir: string): Promise<string[]> {
  return readdir(outDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

async function listBackups(outDir: string): Promise<BackupFile[]> {
  return (await entriesOf(outDir)).filter(isBackupFileName).map((name) => ({ name }));
}

/** Whether the newest backup is at least `intervalDays` old, or there is none. */
function isDue(files: readonly BackupFile[], intervalDays: number, now: Date): boolean {
  const [newest] = planRetention(files, 1).keep;
  const taken = newest
    ? parseBackupTime(newest.name)
    : null;
  return taken === null || now.getTime() - taken.getTime() >= intervalDays * DAY_MS;
}

/** Removes the backups a plan drops. One that cannot be removed is logged and skipped, so the rest still go. */
async function removeDropped(outDir: string, drop: readonly BackupFile[], log: BackupLog): Promise<number> {
  const removals = await Promise.all(
    drop.map(async ({ name }) => {
      try {
        await rm(join(outDir, name));
        return 1;
      } catch (error: unknown) {
        log.warn({ step: 'prune', file: name, reason: describeFailure(error) }, 'an old backup could not be removed');
        return 0;
      }
    }),
  );
  return removals.reduce<number>((total, removed) => total + removed, 0);
}

/**
 * Removes partial dumps left by a process that died mid-dump. They are personal data in the
 * directory this feature manages, and nothing else would ever remove them. Only a stale one
 * goes (see `STALE_PARTIAL_MS`); one that cannot be removed is logged and skipped.
 */
async function sweepStalePartials(outDir: string, now: Date, log: BackupLog): Promise<void> {
  let names: string[];
  try {
    names = (await entriesOf(outDir)).filter(isPartialFileName);
  } catch (error: unknown) {
    log.warn({ step: 'sweep', reason: describeFailure(error) }, 'the backup directory could not be read for stale partials');
    return;
  }
  const swept = await Promise.all(
    names.map(async (name) => {
      try {
        const { mtimeMs } = await stat(join(outDir, name));
        if (now.getTime() - mtimeMs < STALE_PARTIAL_MS) return 0;
        await rm(join(outDir, name), { force: true });
        return 1;
      } catch (error: unknown) {
        log.warn({ step: 'sweep', file: name, reason: describeFailure(error) }, 'a stale partial backup could not be removed');
        return 0;
      }
    }),
  );
  const count = swept.reduce<number>((total, removed) => total + removed, 0);
  if (count > 0) log.info({ step: 'sweep', count }, 'removed stale partial backups');
}

/**
 * The dumper for the dialect the options name, or the active `DIALECT` when they name none:
 * SQLite's `VACUUM INTO` or `pg_dump`. Schedule and retention see only the {@link Dumper} it
 * returns. It is made at each dump, so `DATABASE_URL` is read then and not when the schedule starts.
 *
 * @throws {MissingDatabaseUrlError} for Postgres with no URL; SQLite falls back to its default file.
 */
function dumperFor(opts: BackupOptions, now: Date): Dumper {
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
  const dialect: BackupDialect = opts.dialect ?? DIALECT;
  if (dialect === 'sqlite') return createSqliteDumper({ databaseUrl, now: () => now });
  if (!databaseUrl) throw new MissingDatabaseUrlError();
  return createPgDumper({ databaseUrl, spawn: opts.spawn, now: () => now });
}

/** Writes one dump with the chosen dialect's dumper and returns its path. */
async function dumpNow(opts: BackupOptions): Promise<string> {
  const now = (opts.now ?? (() => new Date()))();
  const { file } = await dumperFor(opts, now).dump(opts.outDir);
  return file;
}

/** Keeps the `keep` newest backups and returns how many older ones were removed. */
async function prune(opts: BackupOptions, keep: number, log: Log): Promise<number> {
  const plan = planRetention(await listBackups(opts.outDir), keep);
  return removeDropped(opts.outDir, plan.drop, log);
}

/** Dumps now, then keeps the `keep` newest backups. A failed dump removes nothing, so the last good one stays. */
async function dumpAndPrune(opts: BackupOptions, settings: BackupSettings, log: Log): Promise<BackupResult> {
  const path = await dumpNow(opts);
  return { path, dropped: await prune(opts, settings.keep, log) };
}

/**
 * One backup now, whatever the interval says and whether or not the schedule is on: a person
 * who runs this has asked for it. `keep` is then read from `app_config`, so the directory does
 * not grow. The dump comes first and does not wait on the settings: a database whose
 * `app_config` cannot be read, such as one not yet migrated, is still backed up, and then no
 * older backup is removed, because with no `keep` to go by removing one could lose data.
 *
 * Its lines carry domain `Backup` and scope `run`, the settings read's fallback warnings included.
 */
export async function runBackupOnce(opts: BackupOptions): Promise<BackupResult> {
  const log = scoped(domainLog(opts.logger), 'run');
  await sweepStalePartials(opts.outDir, (opts.now ?? (() => new Date()))(), log);
  const path = await dumpNow(opts);
  const settings = await readBackupSettings(opts.db, log).catch((error: unknown) => {
    log.warn({ step: 'readSettings', reason: describeFailure(error) }, 'backup settings could not be read; no older backup was removed');
    return undefined;
  });
  return { path, dropped: settings === undefined
    ? 0
    : await prune(opts, settings.keep, log) };
}

/**
 * Starts the backup schedule. With `enabled: false` stored it returns at once with no timer.
 * If the settings cannot be read at start, the schedule starts anyway and tries again at each check;
 * a check that cannot read them goes by the defaults for whether a dump is due, and removes no
 * older backup, as {@link runBackupOnce} does.
 *
 * Otherwise it first sweeps stale partial dumps, then checks whether a backup is due before it returns, and then hourly: a backup
 * is due when none exists or the newest is at least `intervalDays` old. Every check reads
 * the settings again, so turning backups off, or changing `keep` or the interval, applies at
 * the next check without a restart. Checks run one after another, never overlapping.
 *
 * A failed backup is logged (with the dump's own error text and no connection URL) and the
 * schedule goes on; it never throws into the caller's timer. `stop()` clears the timer and
 * waits for a check already running.
 *
 * Its lines carry domain `Backup`: what it does before it returns, the first settings read and
 * the sweep, carries scope `start`, and each check, the first one included, carries scope `run`,
 * as {@link runBackupOnce} does.
 */
export async function startBackupSchedule(opts: BackupScheduleOptions): Promise<{ stop(): Promise<void> }> {
  const domain = domainLog(opts.logger);
  const startLog = scoped(domain, 'start');
  const runLog = scoped(domain, 'run');
  const timers = opts.timers ?? realTimers;
  const now = opts.now ?? (() => new Date());
  // A read that throws here, as a database hiccup at boot would, is logged and is not final: the
  // schedule starts anyway, and the first check and every hourly one after it read the settings
  // again, each logging its own failure, so a database that stays down is reported every hour.
  // Until a read succeeds, the defaults decide whether a dump is due and nothing is pruned: with
  // no settings there is no `keep` to prune by. A database whose `app_config` does not exist yet,
  // such as a SQLite file not yet migrated, is backed up this way.
  //
  // Dumping without the settings follows the rule `readBackupSettings` applies to a stored
  // `enabled` that cannot be used (not a boolean), which it reads as `true` on purpose: a backup
  // nobody wanted is a gitignored 0600 file on the user's own disk, while a silently missing
  // backup is data loss found at the worst moment.
  const readSettings = (log: Log): Promise<BackupSettings | undefined> => readBackupSettings(opts.db, log).catch((error: unknown) => {
    log.error({ step: 'readSettings', reason: describeFailure(error) }, 'backup settings could not be read; the defaults decide and no older backup is removed');
    return undefined;
  });
  const settings = await readSettings(startLog);
  if (settings !== undefined && !settings.enabled) {
    startLog.info({ step: 'readSettings' }, 'backups are off in app_config; no schedule started');
    return { stop: async () => {} };
  }

  let stopped = false;
  let chain: Promise<void> = Promise.resolve();

  const check = async (preloaded?: BackupSettings): Promise<void> => {
    try {
      const current = preloaded ?? (await readSettings(runLog));
      const decide = current ?? BACKUP_DEFAULTS;
      if (!decide.enabled) return;
      if (!isDue(await listBackups(opts.outDir), decide.intervalDays, now())) return;
      const result = current === undefined
        ? { path: await dumpNow(opts), dropped: 0 }
        : await dumpAndPrune(opts, current, runLog);
      runLog.info({ step: 'dump', file: basename(result.path), dropped: result.dropped }, 'backup written');
    } catch (error: unknown) {
      runLog.error({ step: 'dump', reason: describeFailure(error) }, 'backup failed');
    }
  };
  const enqueue = (preloaded?: BackupSettings): Promise<void> => {
    if (!stopped) chain = chain.then(() => check(preloaded));
    return chain;
  };

  await sweepStalePartials(opts.outDir, now(), startLog);
  // An hourly poll and not one interval of `intervalDays`: see CHECK_EVERY_MS for why.
  const handle = timers.setInterval(() => void enqueue(), CHECK_EVERY_MS);
  await enqueue(settings);
  return {
    stop: async () => {
      if (!stopped) timers.clearInterval(handle);
      stopped = true;
      await chain;
    },
  };
}

/**
 * The schedule as a chassis dependency, started and stopped with the service that owns it.
 * `startService` does not use it: a dependency starts before the server listens, and the
 * schedule's first check can run a dump, which must not delay serving. `startService` starts
 * the schedule itself, after the server is up and without awaiting it.
 */
export function createBackupDependency(opts: BackupScheduleOptions): ReturnType<typeof createDependency> {
  let running: { stop(): Promise<void> } | undefined;
  return createDependency({
    name: 'backup-schedule',
    onStart: async () => {
      running = await startBackupSchedule(opts);
    },
    onStop: async () => {
      await running?.stop();
      running = undefined;
    },
  });
}

/** `bun run backup`: one dump and a prune, with the outcome on stdout and a failure on stderr. */
async function main(argv: readonly string[]): Promise<number> {
  if (!argv.includes('--once')) {
    process.stderr.write('usage: bun src/backup/schedule.ts --once\n');
    return 1;
  }
  try {
    const result = await runBackupOnce({ db: getDb(), outDir: DEFAULT_BACKUP_DIR });
    process.stdout.write(`wrote ${basename(result.path)} to backups/ (${result.dropped} older removed)\n`);
    return 0;
  } catch (error: unknown) {
    // Both messages name the variable and never repeat its value, so they are safe to print.
    const named = error instanceof MissingDatabaseUrlError || error instanceof InvalidDatabaseUrlError;
    const reason = named
      ? error.message
      : describeFailure(error);
    process.stderr.write(`backup failed: ${reason}\n`);
    return 1;
  } finally {
    await closeDb();
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
