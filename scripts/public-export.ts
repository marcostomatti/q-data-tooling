// Public export of this repository. Run: bun scripts/public-export.ts --author "Name <email>" <target>
/**
 * Makes the first commit of a public repository from the repository it is run in, the gate
 * between this history and a public one.
 *
 * 1. Refuses a target that exists and is not an empty folder; a missing one is created.
 * 2. Refuses, before writing anything, when `--author` is missing or not `Name <email>`, when
 *    `PRIVACY_DENYLIST` names no file, or when gitleaks is not on `PATH`: this is the gate to a
 *    public repository, so a scan without the denylist or without gitleaks is no scan.
 * 3. Writes `git archive HEAD` into the target: what is committed, never the work tree's changes.
 * 4. Runs `privacy-check.ts` beside this file over the target, with the denylist and gitleaks.
 *    On findings it prints them as the check does, `file:line label`, and exits 1, leaving the
 *    exported files to look at and no `.git` in the target.
 * 5. When clean, runs `git init -b main` in the target and makes one commit, `chore: first public
 *    release`, authored and committed by `--author`. No remote is added. The identity is named on
 *    the command line, never read from git, because it is published with the commit: the one this
 *    machine's git would give may be a work or private address, and `GIT_AUTHOR_*` and
 *    `GIT_COMMITTER_*` in the environment would outrank its config.
 * 6. Prints the two commands that add a remote and push, and runs neither.
 *
 * Usage: PRIVACY_DENYLIST=<file> bun <this file> --author "Name <email>" <target>, from inside the
 * repository to export.
 * Exit: 0 committed, 1 findings, 2 the export could not run.
 *
 * @module
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXIT_CLEAN = 0;
const EXIT_FOUND = 1;
const EXIT_FAILED = 2;
const BRANCH = 'main';
const MESSAGE = 'chore: first public release';
const PRIVACY_CHECK = join(import.meta.dir, 'privacy-check.ts');
const USAGE = 'usage: PRIVACY_DENYLIST=<file> bun scripts/public-export.ts --author "Name <email>" <target>';

/** `Name <email>`: a name, a space, and one address in angle brackets. */
const AUTHOR_SHAPE = /^(\S(?:.*\S)?) <([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>$/;

/**
 * Variables that point git at a repository other than the one `-C <dir>` finds, as a git hook
 * sets them; each git call here names its folder, so they are dropped.
 */
const GIT_LOCATION = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']);

type Run = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };

/** A failure that ends the export with exit 2 and its message on stderr. */
class ExportError extends Error {}

const gitEnv = (): Record<string, string | undefined> => Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !GIT_LOCATION.has(name)));

function spawned(command: readonly string[], extra: Readonly<Record<string, string>> = {}): Run {
  const run = Bun.spawnSync([...command], { env: { ...gitEnv(), ...extra }, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: run.exitCode, stdout: run.stdout.toString().trim(), stderr: run.stderr.toString().trim() };
}

/** Runs git in `dir` and returns its stdout, or throws with what git said. */
function git(dir: string, args: readonly string[], extra: Readonly<Record<string, string>> = {}): string {
  const run = spawned(['git', '-C', dir, ...args], extra);
  if (run.exitCode !== 0) throw new ExportError(`git ${args[0]} failed: ${run.stderr}`);
  return run.stdout;
}

/** A path as one shell word: as it is when it holds only safe characters, single-quoted if not. */
export function shellWord(path: string): string {
  return /^[\w./-]+$/.test(path)
    ? path
    : `'${path.replaceAll('\'', '\'\\\'\'')}'`;
}

/** The two commands that publish the export: add a remote, then push `main` to it. */
export function publishCommands(target: string): readonly string[] {
  const dir = shellWord(target);
  return [`git -C ${dir} remote add origin <url>`, `git -C ${dir} push -u origin ${BRANCH}`];
}

/** Throws when the target exists and is a file, or a folder with anything in it. */
function refuseUsedTarget(target: string): void {
  if (!existsSync(target)) return;
  if (!statSync(target).isDirectory()) throw new ExportError('the target is not a folder');
  if (readdirSync(target).length > 0) throw new ExportError('the target is not empty; name a new or empty folder');
}

/** The denylist `PRIVACY_DENYLIST` names; throws when it names none or a missing file. */
function denylist(): string {
  const path = process.env.PRIVACY_DENYLIST;
  if (path === undefined || path === '') {
    throw new ExportError('PRIVACY_DENYLIST is not set; the export scans with the denylist or not at all');
  }
  if (!existsSync(path)) throw new ExportError('the denylist file PRIVACY_DENYLIST names does not exist');
  return resolve(path);
}

type Identity = { readonly name: string; readonly email: string };

/** `value` read as `Name <email>`; throws when it has another shape. */
export function parseAuthor(value: string): Identity {
  const found = AUTHOR_SHAPE.exec(value);
  if (found === null) throw new ExportError('--author must be "Name <email>", the identity the public commit carries');
  return { name: found[1]!, email: found[2]! };
}

/** The environment that makes `who` the commit's author and committer, whatever git config says. */
function identityEnv(who: Identity): Readonly<Record<string, string>> {
  return {
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_COMMITTER_NAME: who.name,
    GIT_COMMITTER_EMAIL: who.email,
  };
}

/** Writes `git archive HEAD` of the repository at `top` into `target`. */
function archiveInto(top: string, target: string): void {
  const scratch = mkdtempSync(join(tmpdir(), 'public-export-'));
  const tarball = join(scratch, 'head.tar');
  try {
    git(top, ['archive', '--format=tar', `--output=${tarball}`, 'HEAD']);
    const unpacked = spawned(['tar', '-xf', tarball, '-C', target]);
    if (unpacked.exitCode !== 0) throw new ExportError(`tar failed: ${unpacked.stderr}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The privacy check's exit code over `target`, its output passed through as it prints. */
function privacyCheck(target: string, list: string): number {
  const run = Bun.spawnSync([process.execPath, PRIVACY_CHECK, target, '--denylist', list], {
    env: gitEnv(),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return run.exitCode;
}

/** `git init -b main` and the one commit; a half-made `.git` is removed when a step fails. */
function commitIn(target: string, who: Identity): string {
  try {
    git(target, ['init', '-q', '-b', BRANCH]);
    git(target, ['add', '--all', '--force', '.']);
    git(target, ['commit', '-q', '-m', MESSAGE], identityEnv(who));
    return git(target, ['rev-parse', 'HEAD']);
  } catch (error) {
    rmSync(join(target, '.git'), { recursive: true, force: true });
    throw error;
  }
}

function exported(target: string, who: Identity): number {
  refuseUsedTarget(target);
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const list = denylist();
  if (Bun.which('gitleaks') === null) {
    throw new ExportError('gitleaks is not on PATH; the export scans with gitleaks or not at all');
  }
  mkdirSync(target, { recursive: true });
  archiveInto(top, target);
  const scanned = privacyCheck(target, list);
  if (scanned === EXIT_FOUND) {
    console.error('export stopped: the privacy check found the lines above; no commit was made');
    return EXIT_FOUND;
  }
  if (scanned !== EXIT_CLEAN) throw new ExportError(`the privacy check could not run (exit ${scanned})`);
  const sha = commitIn(target, who);
  console.log(`committed ${sha} "${MESSAGE}" by ${who.name} <${who.email}> on ${BRANCH} in ${target}, with no remote`);
  console.log('to publish, add a remote and push:');
  publishCommands(target).forEach((command) => console.log(`  ${command}`));
  return EXIT_CLEAN;
}

type Arguments = { readonly author: string | undefined; readonly target: string | undefined };

/** `--author <value>` or `--author=<value>`, and one target; undefined parts are missing. */
function readArguments(args: readonly string[]): Arguments | null {
  let author: string | undefined;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--author') {
      author = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--author=')) {
      author = arg.slice('--author='.length);
    } else {
      rest.push(arg);
    }
  }
  if (rest.length > 1 || rest.some((arg) => arg === '' || arg.startsWith('-'))) return null;
  return { author, target: rest[0] };
}

function main(args: readonly string[]): number {
  const read = readArguments(args);
  if (read === null || read.target === undefined) {
    console.error(USAGE);
    return EXIT_FAILED;
  }
  try {
    if (read.author === undefined) throw new ExportError(`--author is required; ${USAGE}`);
    return exported(resolve(read.target), parseAuthor(read.author));
  } catch (error) {
    if (!(error instanceof ExportError)) throw error;
    console.error(`export could not run: ${error.message}`);
    return EXIT_FAILED;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
