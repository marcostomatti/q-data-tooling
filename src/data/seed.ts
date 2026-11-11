/**
 * The seed runner behind `bun run db:seed`: runs the seed files in `src/data/seeds/` against the
 * database `DATABASE_URL` names, one transaction per file, in file-name order.
 *
 * A seed file is named `<NN>-<name>.ts` (two digits, then a lower-case kebab name), so the
 * prefix orders the files, and exports `seed(db: Db): Promise<void>`. Each file's `seed` runs
 * inside `transact(db, body)`, so a seed that throws leaves none of its own writes behind, while
 * the seeds before it stay committed. The runner stops at the first failure and names the file.
 *
 * The runner does not record which seeds ran: every run runs every file again. A seed is
 * therefore idempotent by contract, writing on a natural key with `onConflictDoNothing`, and
 * the runner does not check it. A missing `src/data/seeds/` folder is zero seeds, not an error,
 * because the template ships none.
 *
 * @module
 */

import type { Db } from './repositories/db.ts';

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { inDomain, lazyLogger, scoped, type Log } from '../logging.ts';

import { closeDb, DIALECT, getDb, transact } from './active.ts';
import { faultCode } from './driver-faults.ts';

/** What a seed file exports: one function that writes its rows through the `Db` it is given. */
export interface SeedModule {
  seed(db: Db): Promise<void>
}

/** A seed file's name: two digits, a dash, a lower-case kebab name, `.ts`. */
export const SEED_FILE_NAME = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;

/** The folder `bun run db:seed` reads, whatever the working directory is. */
export const SEEDS_FOLDER = join(import.meta.dir, 'seeds');

/** A `.ts` file in the seeds folder whose name is not `<NN>-<name>.ts`, so its order is unknown. */
export class SeedNameError extends Error {
  readonly file: string;

  constructor(file: string) {
    super(`seed file ${file} is not named <NN>-<name>.ts`);
    this.name = 'SeedNameError';
    this.file = file;
  }
}

/**
 * A seed that failed: the file does not export a `seed` function, or its `seed` threw. The
 * file's own error, when there is one, is the `cause`; the message names only the file, since
 * a driver's message can repeat a whole statement.
 */
export class SeedFailedError extends Error {
  readonly file: string;

  constructor(file: string, cause?: unknown) {
    super(`seed ${file} failed`, { cause });
    this.name = 'SeedFailedError';
    this.file = file;
  }
}

/**
 * The seed files in `folder`, in the order they run. Files that are not `.ts` (a README) are
 * left out; a `.ts` file off the naming pattern is refused rather than skipped, so a misnamed
 * seed is never silently not run.
 *
 * @param folder - The seeds folder. Defaults to `src/data/seeds/`.
 * @returns The file names, sorted; empty when the folder does not exist.
 * @throws {SeedNameError} When a `.ts` file in the folder is not named `<NN>-<name>.ts`.
 */
export function listSeeds(folder: string = SEEDS_FOLDER): string[] {
  if (!existsSync(folder)) return [];
  const files = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name);
  const misnamed = files.find((file) => !SEED_FILE_NAME.test(file));
  if (misnamed !== undefined) throw new SeedNameError(misnamed);
  return files.sort();
}

/** The `seed` function `file` exports; a file without one fails as that seed. */
async function loadSeed(folder: string, file: string): Promise<SeedModule['seed']> {
  const loaded: unknown = await import(join(folder, file));
  const seed: unknown = Reflect.get(loaded as object, 'seed');
  if (typeof seed !== 'function') throw new SeedFailedError(file);
  return seed as SeedModule['seed'];
}

/**
 * Runs every seed in `folder`, in order, each inside its own `transact`.
 *
 * @param db - The client to seed. Defaults to the active dialect's process-wide one.
 * @param folder - The seeds folder. Defaults to `src/data/seeds/`.
 * @returns The file names of the seeds that ran, in order; empty when there are none.
 * @throws {SeedNameError} When a `.ts` file in the folder is misnamed; no seed has run then.
 * @throws {SeedFailedError} At the first seed that fails; the ones before it stay committed and
 * the ones after it do not run.
 */
export async function runSeeds(db: Db = getDb(), folder: string = SEEDS_FOLDER): Promise<string[]> {
  const ran: string[] = [];
  for (const file of listSeeds(folder)) {
    const seed = await loadSeed(folder, file);
    try {
      await transact(db, (tx) => seed(tx));
    } catch (error) {
      throw new SeedFailedError(file, error);
    }
    ran.push(file);
  }
  return ran;
}

const defaultLogger = lazyLogger('seed');

/** The domain every line of the database scripts carries. */
const DOMAIN = 'Db';

/** What {@link seedCommand} runs with; a test passes its own, and each defaults to the real one. */
export type SeedCommandDeps = {
  /** Runs the seeds and returns the names of those that ran. Defaults to {@link runSeeds}. */
  readonly seed?: () => Promise<string[]>
  /** Closes the database once the run is over. Defaults to `closeDb` of `active.ts`. */
  readonly close?: () => Promise<void>
  /** The base log; the command binds `domain` and `scope` on it. Defaults to the `seed` logger. */
  readonly log?: Log
};

/**
 * `bun run db:seed`: seeds the database `DATABASE_URL` names and logs which seeds ran, signed
 * `Db:seed`. A failure is logged by the seed file and its driver code (see `driver-faults.ts`)
 * and exits 1; a misnamed file is the `list` step, any other failure the `run` step.
 *
 * @param deps - What the command runs with; every field has a real default.
 * @returns The process exit code: 0 on success, 1 on a failure.
 */
export async function seedCommand(deps: SeedCommandDeps = {}): Promise<number> {
  const log = scoped(inDomain(deps.log ?? defaultLogger(), DOMAIN), 'seed');
  try {
    const ran = await (deps.seed ?? (() => runSeeds()))();
    log.info({ step: 'run', dialect: DIALECT, ran: ran.length, seeds: ran }, ran.length === 0
      ? 'no seeds ran'
      : 'ran seeds');
    return 0;
  } catch (error) {
    // By code, never by message: a driver's message can repeat a statement or the URL.
    const file = error instanceof SeedFailedError || error instanceof SeedNameError
      ? error.file
      : undefined;
    const cause = error instanceof SeedFailedError
      ? error.cause
      : error;
    const misnamed = error instanceof SeedNameError;
    const step = misnamed
      ? 'list'
      : 'run';
    log.error({ step, dialect: DIALECT, seed: file, code: faultCode(cause) }, misnamed
      ? 'seed file misnamed'
      : 'seed failed');
    return 1;
  } finally {
    await (deps.close ?? closeDb)();
  }
}

if (import.meta.main) {
  process.exitCode = await seedCommand();
}
