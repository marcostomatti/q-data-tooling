/**
 * `bun run test:db`: runs the database tests that fit the active dialect and the databases that
 * exist, each suite as its own `bun test` subprocess, and prints one line per suite, run or left
 * out, with the reason a suite was left out. No suite is left out silently.
 *
 * - The active dialect is the `#db` entry of `package.json`, read with `dialectFolderOf`.
 * - SQLite always exists. Postgres exists when `TEST_PG_URL` is set and `select 1` answers
 *   within {@link PROBE_TIMEOUT_MS}.
 * - The suites are {@link SQLITE_SUITE}, {@link PG_BUILD_SUITE} and {@link POSTGRES_SUITE}; the
 *   files of each are the named constants below, expanded by glob when the command runs.
 * - When {@link POSTGRES_SUITE} is left out on the SQLite build, its files join
 *   {@link SQLITE_SUITE} without `TEST_PG_URL`, so their blocks that need no server still run
 *   and their `describePg` blocks skip.
 *
 * The command exits 1 when a suite it ran failed (its `bun test` exited non-zero or counted a
 * failure), or when the active dialect's database does not exist (the Postgres build with no
 * answering server); 0 otherwise. {@link planTestDb} holds the deciding logic as a pure function,
 * so its tests need no server and spawn no `bun test`.
 *
 * @module
 */

import { dirname, resolve } from 'node:path';

import postgres from 'postgres';

import { dialectFolderOf, type DialectFolder } from '../drizzle.config.ts';
import packageJson from '../package.json' with { type: 'json' };
import { faultCode } from '../src/data/driver-faults.ts';

/** The checkout root: every suite file is relative to it, and every `bun test` runs in it. */
export const PROJECT_ROOT: string = resolve(dirname(import.meta.path), '..');

/** The variable that names the Postgres server the gated tests may write in. */
export const PG_URL_VARIABLE = 'TEST_PG_URL';

/** How long the probe waits for `select 1` before it calls Postgres absent. */
export const PROBE_TIMEOUT_MS = 2000;

/** The code the `postgres` client fails with when its own `connect_timeout` runs out. */
const CLIENT_CONNECT_TIMEOUT = 'CONNECT_TIMEOUT';

/** The SQLite build's suite: the database tests that need no server. */
export const SQLITE_SUITE = 'sqlite';

/** The Postgres build's suite: the repository tests and the Postgres dialect folder's test. */
export const PG_BUILD_SUITE = 'pg-build';

/** The Postgres-direct suite: the `describePg` files, on either build, when a server answers. */
export const POSTGRES_SUITE = 'postgres';

/** A suite's name, as its printed line opens. */
export type SuiteName = typeof SQLITE_SUITE | typeof PG_BUILD_SUITE | typeof POSTGRES_SUITE;

/**
 * The files that call `describePg`, run with `TEST_PG_URL` passed through. Their blocks that need
 * no server run with them, or, when no server answers on the SQLite build, in {@link SQLITE_SUITE}.
 */
export const POSTGRES_DIRECT_FILES: readonly string[] = [
  'tests/data/migrate.test.ts',
  'tests/data/migration-status.test.ts',
  'tests/data/pg/client.test.ts',
  'tests/data/pg/dependency.test.ts',
  'tests/data/schema-tables.test.ts',
  'tests/mcp/bulk.test.ts',
];

/** The route repository tests, which belong to both builds' suites. */
const ROUTE_REPOSITORY_GLOB = 'tests/routes/**/repository.test.ts';

/**
 * {@link SQLITE_SUITE}'s files, {@link POSTGRES_DIRECT_FILES} excluded; {@link planTestDb} adds
 * those back when {@link POSTGRES_SUITE} does not run.
 */
export const SQLITE_GLOBS: readonly string[] = [
  'tests/data/*.test.ts',
  'tests/data/sqlite/**/*.test.ts',
  'tests/repositories/**/*.test.ts',
  'tests/support/sqlite-db.test.ts',
  ROUTE_REPOSITORY_GLOB,
];

/** {@link PG_BUILD_SUITE}'s files, {@link POSTGRES_DIRECT_FILES} excluded. */
export const PG_BUILD_GLOBS: readonly string[] = [
  'tests/repositories/**/*.test.ts',
  ROUTE_REPOSITORY_GLOB,
  'tests/data/pg/index.test.ts',
];

/** What the probe found of Postgres. */
export type PostgresProbe =
  | { state: 'unset' }
  | { state: 'answered' }
  | { state: 'silent', reason: string };

/** The expanded files of each suite, relative to {@link PROJECT_ROOT}. */
export type SuiteFiles = Readonly<Record<SuiteName, readonly string[]>>;

/** One suite of the plan: run over its files, or left out for a reason. */
export type SuitePlan =
  | { name: SuiteName, run: true, files: readonly string[], withPgUrl: boolean }
  | { name: SuiteName, run: false, reason: string };

/** What {@link planTestDb} decides. */
export type TestDbPlan = {
  /** One entry per suite, in the order the command prints them. */
  suites: readonly SuitePlan[]
  /** Why the active dialect's database does not exist, when it does not; the command exits 1. */
  missingActiveDatabase: string | undefined
};

/** What {@link planTestDb} reads. */
export type PlanInput = {
  /** The active dialect folder, from `#db`. */
  dialect: DialectFolder
  /** What the probe found of Postgres. */
  postgres: PostgresProbe
  /** The expanded files of each suite. */
  files: SuiteFiles
};

/** The printed reason for a Postgres that is not there. */
function postgresAbsence(probe: Exclude<PostgresProbe, { state: 'answered' }>): string {
  return probe.state === 'unset'
    ? `${PG_URL_VARIABLE} is not set`
    : probe.reason;
}

/** A suite that runs over `files`, or is left out when no file matches its constant. */
function runOver(name: SuiteName, files: readonly string[], withPgUrl: boolean): SuitePlan {
  return files.length === 0
    ? { name, run: false, reason: 'no test file matches its patterns' }
    : { name, run: true, files, withPgUrl };
}

/**
 * Decides which suites run and why the others do not, from the active dialect, the probe's
 * result and the files each suite's constant expands to. On the SQLite build with no answering
 * Postgres, the SQLite suite also takes the Postgres-direct files, so their server-free blocks
 * run; with a server they run once, in the Postgres-direct suite.
 *
 * @param input - The dialect, the probe's result and the suites' files.
 * @returns One {@link SuitePlan} per suite, SQLite first, and the active database's absence.
 */
export function planTestDb(input: PlanInput): TestDbPlan {
  const { dialect, postgres: probe, files } = input;
  const answered = probe.state === 'answered';
  const sqliteFiles = answered
    ? files[SQLITE_SUITE]
    : [...new Set([...files[SQLITE_SUITE], ...files[POSTGRES_SUITE]])].sort();
  const sqlite = dialect === 'sqlite'
    ? runOver(SQLITE_SUITE, sqliteFiles, false)
    : { name: SQLITE_SUITE, run: false, reason: 'the active dialect is pg' } as const;
  const pgBuild = dialect !== 'pg'
    ? { name: PG_BUILD_SUITE, run: false, reason: `the active dialect is ${dialect}` } as const
    : answered
      ? runOver(PG_BUILD_SUITE, files[PG_BUILD_SUITE], true)
      : { name: PG_BUILD_SUITE, run: false, reason: postgresAbsence(probe) } as const;
  const direct = answered
    ? runOver(POSTGRES_SUITE, files[POSTGRES_SUITE], true)
    : { name: POSTGRES_SUITE, run: false, reason: postgresAbsence(probe) } as const;
  const missingActiveDatabase = dialect === 'pg' && !answered
    ? `the active dialect is pg and Postgres does not exist: ${postgresAbsence(probe)}`
    : undefined;
  return { suites: [sqlite, pgBuild, direct], missingActiveDatabase };
}

/** The pass, fail and skip counts of one `bun test` run, when its summary could be read. */
export type SuiteCounts = { pass: number, fail: number, skip: number };

/** What a suite's `bun test` subprocess returned. */
export type SuiteResult = {
  /** The suite that ran. */
  name: SuiteName
  /** The number of files it was given. */
  fileCount: number
  /** The subprocess's exit code. */
  exitCode: number
  /** The counts of its summary, or `undefined` when the summary has no pass or fail line. */
  counts: SuiteCounts | undefined
};

/** An SGR escape, which a coloured summary would wrap its counts in. */
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

/** The count on a summary line such as ` 20 pass`, or `undefined` when no such line exists. */
function countOf(text: string, word: string): number | undefined {
  const match = new RegExp(`^\\s*(\\d+) ${word}\\s*$`, 'm').exec(text);
  return match?.[1] === undefined
    ? undefined
    : Number(match[1]);
}

/**
 * Reads `bun test`'s summary counts from its output. Bun prints ` N pass` and ` N fail` on every
 * run, and ` N skip` only when a test was skipped, so a missing skip line counts as 0.
 *
 * @param output - The subprocess's stdout and stderr, in either order.
 * @returns The counts, or `undefined` when the pass or the fail line is missing.
 */
export function parseBunTestCounts(output: string): SuiteCounts | undefined {
  const text = output.replace(ANSI_ESCAPE, '');
  const pass = countOf(text, 'pass');
  const fail = countOf(text, 'fail');
  if (pass === undefined || fail === undefined) return undefined;
  return { pass, fail, skip: countOf(text, 'skip') ?? 0 };
}

/** Whether a suite that ran failed: a non-zero exit, a counted failure, or an unread summary. */
export function suiteFailed(result: SuiteResult): boolean {
  return result.exitCode !== 0 || result.counts === undefined || result.counts.fail > 0;
}

/**
 * The printed line of a suite, run or left out, such as
 * `postgres: not run, TEST_PG_URL is not set`.
 *
 * @param entry - A suite left out, or the result of one that ran.
 * @returns The line, without its newline.
 */
export function formatSuiteLine(entry: Extract<SuitePlan, { run: false }> | SuiteResult): string {
  if ('reason' in entry) return `${entry.name}: not run, ${entry.reason}`;
  const files = `${entry.fileCount} ${entry.fileCount === 1
    ? 'file'
    : 'files'}`;
  const counts = entry.counts === undefined
    ? 'counts not read from its output'
    : `${entry.counts.pass} pass, ${entry.counts.fail} fail, ${entry.counts.skip} skip`;
  return `${entry.name}: ran ${files}, ${counts}, exit ${entry.exitCode}`;
}

/**
 * The command's exit code: 1 when the active dialect's database does not exist or a suite that
 * ran failed, 0 otherwise.
 *
 * @param plan - What {@link planTestDb} decided.
 * @param results - The results of the suites that ran.
 */
export function testDbExitCode(plan: TestDbPlan, results: readonly SuiteResult[]): 0 | 1 {
  return plan.missingActiveDatabase !== undefined || results.some(suiteFailed)
    ? 1
    : 0;
}

/**
 * Probes the Postgres server `TEST_PG_URL` names with `select 1`, through a one-connection
 * `postgres` client that is closed after the probe. A failure is named by its driver code, never
 * its message, which can repeat the URL with its password.
 *
 * @param env - Where `TEST_PG_URL` is read; an empty value counts as unset.
 * @param timeoutMs - How long `select 1` may take, connecting included.
 * @returns What the probe found.
 */
export async function probePostgres(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<PostgresProbe> {
  const url = env[PG_URL_VARIABLE];
  if (url === undefined || url === '') return { state: 'unset' };
  const seconds = timeoutMs / 1000;
  const late: PostgresProbe = { state: 'silent', reason: `select 1 did not answer within ${seconds} seconds` };
  const sql = postgres(url, { max: 1, connect_timeout: seconds, onnotice: () => {} });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PostgresProbe>((settle) => {
    timer = setTimeout(() => settle(late), timeoutMs);
  });
  // The client's own connect timeout fires at the same deadline as the timer, so its fault
  // reads as the same lateness whichever of the two fires first.
  const answered = sql`select 1`.then(
    (): PostgresProbe => ({ state: 'answered' }),
    (error: unknown): PostgresProbe => {
      const code = faultCode(error);
      return code === CLIENT_CONNECT_TIMEOUT
        ? late
        : { state: 'silent', reason: `select 1 failed with ${code}` };
    },
  );
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
    await sql.end({ timeout: 0 });
  }
}

/** Expands `globs` under `root`, drops `excluded`, and sorts what is left. */
export function expandGlobs(globs: readonly string[], excluded: readonly string[], root: string = PROJECT_ROOT): string[] {
  const found = new Set<string>();
  for (const pattern of globs) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: root })) found.add(file);
  }
  return [...found].filter((file) => !excluded.includes(file)).sort();
}

/** The files of each suite, expanded from the constants under `root`. */
export function suiteFilesUnder(root: string = PROJECT_ROOT): SuiteFiles {
  return {
    [SQLITE_SUITE]: expandGlobs(SQLITE_GLOBS, POSTGRES_DIRECT_FILES, root),
    [PG_BUILD_SUITE]: expandGlobs(PG_BUILD_GLOBS, POSTGRES_DIRECT_FILES, root),
    [POSTGRES_SUITE]: [...POSTGRES_DIRECT_FILES],
  };
}

/**
 * The environment a suite's subprocess gets: the parent's, without `TEST_PG_URL` unless the
 * suite takes it, so no gated block of a suite that needs no server reaches one.
 */
export function suiteEnv(suite: Extract<SuitePlan, { run: true }>, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (suite.withPgUrl) return { ...env };
  const { [PG_URL_VARIABLE]: _dropped, ...rest } = env;
  return rest;
}

/** Where a subprocess's output is forwarded: `process.stdout`, `process.stderr` or a stand-in. */
export type OutputSink = { write(chunk: Uint8Array): unknown };

/** Copies `stream` to `sink` as it arrives, and returns all of it as text. */
async function tee(stream: ReadableStream<Uint8Array>, sink: OutputSink): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) {
    sink.write(chunk);
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/** How {@link runSuite} starts its subprocess; the defaults are the real `bun test`. */
export type RunOptions = {
  /** The command the suite's files are appended to. Defaults to `bun test`. */
  command?: readonly string[]
  /** Where the subprocess runs. Defaults to {@link PROJECT_ROOT}. */
  cwd?: string
  /** The parent environment {@link suiteEnv} narrows. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Where the subprocess's stdout goes. Defaults to `process.stdout`. */
  stdout?: OutputSink
  /** Where the subprocess's stderr goes. Defaults to `process.stderr`. */
  stderr?: OutputSink
};

/**
 * Runs one suite as a subprocess, forwards its stdout and stderr as they arrive, and reads its
 * exit code and summary counts. Each file is passed as `./<file>`, which `bun test` takes as a
 * path rather than a name filter.
 *
 * @param suite - A suite the plan runs.
 * @param options - The command, directory and environment; the defaults run `bun test`.
 * @returns The suite's result.
 */
export async function runSuite(suite: Extract<SuitePlan, { run: true }>, options: RunOptions = {}): Promise<SuiteResult> {
  const command = options.command ?? [process.execPath, 'test'];
  const child = Bun.spawn([...command, ...suite.files.map((file) => `./${file}`)], {
    cwd: options.cwd ?? PROJECT_ROOT,
    env: suiteEnv(suite, options.env ?? process.env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    tee(child.stdout, options.stdout ?? process.stdout),
    tee(child.stderr, options.stderr ?? process.stderr),
  ]);
  const exitCode = await child.exited;
  return { name: suite.name, fileCount: suite.files.length, exitCode, counts: parseBunTestCounts(`${stdout}\n${stderr}`) };
}

async function main(): Promise<void> {
  const plan = planTestDb({
    dialect: dialectFolderOf(packageJson.imports['#db']),
    postgres: await probePostgres(),
    files: suiteFilesUnder(),
  });
  const results: SuiteResult[] = [];
  for (const suite of plan.suites) {
    if (!suite.run) continue;
    process.stdout.write(`\ntest:db: running ${suite.name}\n`);
    results.push(await runSuite(suite));
  }
  const lines = plan.suites.map((suite) => {
    if (!suite.run) return formatSuiteLine(suite);
    const result = results.find((ran) => ran.name === suite.name);
    return result === undefined
      ? `${suite.name}: no result`
      : formatSuiteLine(result);
  });
  if (plan.missingActiveDatabase !== undefined) lines.push(`test:db: ${plan.missingActiveDatabase}`);
  process.stdout.write(`\n${lines.join('\n')}\n`);
  process.exit(testDbExitCode(plan, results));
}

if (import.meta.main) {
  await main();
}
