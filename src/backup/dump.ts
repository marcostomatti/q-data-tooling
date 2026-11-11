/**
 * What every dialect's dump has in common, and nothing a dialect owns: the Postgres dumper is
 * `pg-dump.ts`, the SQLite one `sqlite-dump.ts`. Schedule and retention see a backup through
 * this interface only.
 */

/** One finished backup: its path, and its size on disk in bytes (never 0, which is no backup). */
export type DumpResult = {
  readonly file: string
  readonly bytes: number
};

/**
 * Writes one backup of the database it was made for into `outDir`, which it creates when it is
 * missing, and resolves once the file sits under its final name. A dump that fails rejects
 * with a {@link BackupDumpError} and leaves no file that retention would count as a backup.
 */
export type Dumper = {
  dump(outDir: string): Promise<DumpResult>
};

/**
 * A dump that failed. Its message is safe to log and to show: each dumper builds it from
 * nothing that names the connection, its credential or the machine it runs on.
 */
export class BackupDumpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupDumpError';
  }
}
