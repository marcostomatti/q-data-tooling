import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';

import { faultCode } from '../data/driver-faults.ts';
import { databasePath, InvalidDatabaseUrlError, MEMORY_DATABASE } from '../data/sqlite/client.ts';

import { BackupDumpError, type DumpResult, type Dumper } from './dump.ts';
import { backupFileName, partialFileName } from './retention.ts';

export type SqliteDumperOptions = {
  /** The SQLite `DATABASE_URL`: `file:<path>`, or unset for the default path. */
  readonly databaseUrl: string | undefined
  /** The clock that names each file. Defaults to the system's. */
  readonly now?: () => Date
};

/** What one dump needs: the options, with the clock read. */
type SqliteDumpRun = {
  readonly databaseUrl: string | undefined
  readonly outDir: string
  readonly now: Date
};

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/** The database file to copy from, or a dump error for a URL that names none a second connection can read. */
function sourcePath(databaseUrl: string | undefined): string {
  let path: string;
  try {
    path = databasePath(databaseUrl);
  } catch (error: unknown) {
    if (error instanceof InvalidDatabaseUrlError) throw new BackupDumpError(error.message);
    throw error;
  }
  // A second connection to `:memory:` opens a new, empty database, so there is nothing to copy.
  if (path === MEMORY_DATABASE) throw new BackupDumpError('an in-memory SQLite database (`:memory:`) cannot be backed up');
  return path;
}

/** Opens the existing database for the copy; a missing file is an error here, never a new empty database. */
function openSource(path: string): Database {
  try {
    return new Database(path, { readwrite: true, create: false });
  } catch (error: unknown) {
    throw new BackupDumpError(`the SQLite database could not be opened (${faultCode(error)})`);
  }
}

/**
 * The SQLite {@link Dumper}: each `dump(outDir)` writes one backup of the database the URL names
 * into `outDir` and returns its path and size. The URL is read at each dump, not here, so an
 * unusable one rejects that dump and opens no database.
 *
 * A `:memory:` URL is refused, since a second connection to it opens a new, empty database, and
 * so is a file that does not exist, which is never created by a dump.
 */
export function createSqliteDumper(opts: SqliteDumperOptions): Dumper {
  const clock = opts.now ?? (() => new Date());
  return { dump: (outDir) => runSqliteDump({ databaseUrl: opts.databaseUrl, outDir, now: clock() }) };
}

/**
 * Writes one backup of the SQLite database into `outDir`.
 *
 * The copy is SQLite's own `VACUUM INTO`, never a file copy: a copy of the file can catch a write
 * half done, and misses what is still in the WAL, while `VACUUM INTO` writes a consistent
 * database from one read transaction. The file is a plain SQLite database, which
 * `new Database(file)` opens as it is.
 *
 * It is written beside its final name and moved into place only once complete, so a failed
 * dump never leaves a file that retention would count as the newest backup. The directory and the
 * file are private to their owner, as the Postgres dump's are. A failure is reported by the
 * driver's code, never its message, which can repeat the statement and so the path.
 */
async function runSqliteDump(opts: SqliteDumpRun): Promise<DumpResult> {
  const source = sourcePath(opts.databaseUrl);
  const finalPath = join(opts.outDir, backupFileName(opts.now));
  const partialPath = partialFileName(finalPath);

  await mkdir(opts.outDir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  // `VACUUM INTO` refuses a target that exists; a stale partial of the same second is no backup.
  await rm(partialPath, { force: true });
  const sqlite = openSource(source);
  try {
    sqlite.run('VACUUM INTO ?', [partialPath]);
  } catch (error: unknown) {
    await rm(partialPath, { force: true });
    throw new BackupDumpError(`VACUUM INTO failed (${faultCode(error)})`);
  } finally {
    sqlite.close();
  }
  const written = await stat(partialPath).catch(() => null);
  if (!written || written.size === 0) {
    await rm(partialPath, { force: true });
    throw new BackupDumpError('VACUUM INTO ended cleanly but wrote no file');
  }
  await chmod(partialPath, PRIVATE_FILE_MODE);
  await rename(partialPath, finalPath);
  return { file: finalPath, bytes: written.size };
}
