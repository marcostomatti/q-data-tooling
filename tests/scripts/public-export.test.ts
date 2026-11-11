import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { publishCommands, shellWord } from '../../scripts/public-export.ts';

const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'public-export.ts');

/**
 * Joins fragments, so a fixture that must hit a rule does not sit whole in this file and make the
 * file a hit of its own.
 */
function joined(...fragments: string[]): string {
  return fragments.join('');
}

const PLANTED = joined('place', 'holder');
const NAME = 'Tester';
const EMAIL = 'tester@example.test';

/** The identity `--author` names, which is never the source repository's own. */
const AUTHOR = 'Public Name <public@example.test>';

const made: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'public-export-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/**
 * The environment without the variables a git hook sets, a denylist the caller named, an identity
 * from the environment, or the user's own git config, so the temporary repository's config is the
 * only one git reads.
 */
function baseEnv(): Record<string, string | undefined> {
  const {
    GIT_DIR: _dir,
    GIT_WORK_TREE: _tree,
    GIT_INDEX_FILE: _index,
    GIT_AUTHOR_NAME: _authorName,
    GIT_AUTHOR_EMAIL: _authorEmail,
    GIT_COMMITTER_NAME: _committerName,
    GIT_COMMITTER_EMAIL: _committerEmail,
    PRIVACY_DENYLIST: _denylist,
    ...rest
  } = process.env;
  return { ...rest, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
}

function gitIn(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', dir, ...args], { env: baseEnv(), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** A repository with an identity of its own and the files given, committed as one commit. */
function repo(files: Readonly<Record<string, string>>): string {
  const dir = tempDir();
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'config', 'user.name', NAME);
  gitIn(dir, 'config', 'user.email', EMAIL);
  Object.entries(files).forEach(([file, text]) => writeFileSync(join(dir, file), text));
  gitIn(dir, 'add', '--all');
  gitIn(dir, 'commit', '-q', '--no-verify', '-m', 'private history');
  return dir;
}

/** A `gitleaks` stand-in that writes an empty JSON report, as no gitleaks is installed. */
function stubGitleaks(): string {
  const bin = tempDir();
  const stub = join(bin, 'gitleaks');
  writeFileSync(stub, [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do',
    '  if [ "$1" = "--report-path" ]; then printf "[]" > "$2"; fi',
    '  shift',
    'done',
    '',
  ].join('\n'));
  chmodSync(stub, 0o755);
  return bin;
}

/** A folder holding only `git` and `tar`, so a run finds them and no gitleaks on any host. */
function toolsOnly(): string {
  const bin = tempDir();
  ['git', 'tar'].forEach((tool) => {
    const found = Bun.which(tool);
    if (found === null) throw new Error(`${tool} is not on PATH`);
    symlinkSync(found, join(bin, tool));
  });
  return bin;
}

/** A denylist naming the planted word, written outside every repository the test makes. */
function denylistFile(): string {
  const list = join(tempDir(), 'denylist.tsv');
  writeFileSync(list, `word:label-one\t${PLANTED}\n`);
  return list;
}

type Run = { exitCode: number; stdout: string; stderr: string };

type Options = {
  readonly gitleaks?: boolean
  readonly denylist?: string
  /** The `--author` value; `null` leaves the flag out. */
  readonly author?: string | null
  readonly env?: Readonly<Record<string, string>>
};

/** The export of `source` into `target`, run from inside `source`. */
function exportRun(source: string, target: string, options: Options = {}): Run {
  const path = (options.gitleaks ?? true)
    ? `${stubGitleaks()}:${toolsOnly()}`
    : toolsOnly();
  const env = {
    ...baseEnv(),
    ...options.env,
    PATH: path,
    ...(options.denylist === undefined
      ? {}
      : { PRIVACY_DENYLIST: options.denylist }),
  };
  const author = options.author === undefined
    ? AUTHOR
    : options.author;
  const flags = author === null
    ? []
    : ['--author', author];
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...flags, target], { cwd: source, env, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const CLEAN_FILES = { 'a.txt': 'host 192.0.2.9\n', 'README.md': '# a template\n' };

describe('the publish commands', () => {
  test('add a remote and push main, naming the target as one shell word', () => {
    expect(publishCommands('/tmp/out')).toEqual(['git -C /tmp/out remote add origin <url>', 'git -C /tmp/out push -u origin main']);
    expect(shellWord('/tmp/my out')).toBe('\'/tmp/my out\'');
    expect(shellWord('/tmp/it\'s')).toBe('\'/tmp/it\'\\\'\'s\'');
  });
});

describe('the export', () => {
  test('refuses a target that holds a file, and leaves it as it was', () => {
    const source = repo(CLEAN_FILES);
    const target = tempDir();
    writeFileSync(join(target, 'kept.txt'), 'mine\n');

    const result = exportRun(source, target, { denylist: denylistFile() });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('the target is not empty');
    expect(readdirSync(target)).toEqual(['kept.txt']);
  });

  test('exits 2 without PRIVACY_DENYLIST, before writing the target', () => {
    const source = repo(CLEAN_FILES);
    const target = join(tempDir(), 'out');

    const result = exportRun(source, target);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('PRIVACY_DENYLIST is not set');
    expect(existsSync(target)).toBe(false);
  });

  test('exits 2 without --author, before writing the target', () => {
    const source = repo(CLEAN_FILES);
    const target = join(tempDir(), 'out');

    const result = exportRun(source, target, { denylist: denylistFile(), author: null });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--author');
    expect(existsSync(target)).toBe(false);
  });

  test.each(['Public Name', 'public@example.test', '<public@example.test>', 'Public Name <not an address>'])(
    'exits 2 for --author %p, which is not "Name <email>", before writing the target',
    (author) => {
      const source = repo(CLEAN_FILES);
      const target = join(tempDir(), 'out');

      const result = exportRun(source, target, { denylist: denylistFile(), author });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('--author must be "Name <email>"');
      expect(existsSync(target)).toBe(false);
    },
  );

  test('exits 2 when gitleaks is not on PATH, before writing the target', () => {
    const source = repo(CLEAN_FILES);
    const target = join(tempDir(), 'out');

    const result = exportRun(source, target, { gitleaks: false, denylist: denylistFile() });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('gitleaks is not on PATH');
    expect(existsSync(target)).toBe(false);
  });

  test('a planted denylist word ends in exit 1, its finding printed, and no .git', () => {
    const source = repo({ ...CLEAN_FILES, 'notes.txt': `fine\nsee ${PLANTED}\n` });
    const target = join(tempDir(), 'out');

    const result = exportRun(source, target, { denylist: denylistFile() });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('notes.txt:2 label-one\n1 finding(s)\n');
    expect(result.stdout).not.toContain(PLANTED);
    expect(result.stderr).not.toContain(PLANTED);
    expect(existsSync(join(target, 'notes.txt'))).toBe(true);
    expect(existsSync(join(target, '.git'))).toBe(false);
  });

  test('a clean tree ends in one commit of HEAD on main, by the --author identity, with no remote', () => {
    const source = repo({ ...CLEAN_FILES, 'run.sh': '#!/bin/sh\n' });
    chmodSync(join(source, 'run.sh'), 0o755);
    gitIn(source, 'add', 'run.sh');
    gitIn(source, 'commit', '-q', '--no-verify', '-m', 'make it runnable');
    writeFileSync(join(source, 'uncommitted.txt'), 'not in HEAD\n');
    mkdirSync(join(source, 'sub'));
    const target = join(tempDir(), 'out');
    // An identity in the environment outranks git config, so the export has to set its own.
    const other = { NAME: 'Machine Name', EMAIL: 'machine@example.test' };
    const env = {
      GIT_AUTHOR_NAME: other.NAME,
      GIT_AUTHOR_EMAIL: other.EMAIL,
      GIT_COMMITTER_NAME: other.NAME,
      GIT_COMMITTER_EMAIL: other.EMAIL,
    };

    const result = exportRun(join(source, 'sub'), target, { denylist: denylistFile(), env });

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(gitIn(target, 'log', '--format=%s')).toBe('chore: first public release');
    expect(gitIn(target, 'log', '--format=%an <%ae>|%cn <%ce>')).toBe(`${AUTHOR}|${AUTHOR}`);
    expect(gitIn(source, 'log', '-1', '--format=%an <%ae>')).toBe(`${NAME} <${EMAIL}>`);
    expect(gitIn(target, 'branch', '--show-current')).toBe('main');
    expect(gitIn(target, 'remote', '-v')).toBe('');
    expect(gitIn(target, 'rev-parse', 'HEAD^{tree}')).toBe(gitIn(source, 'rev-parse', 'HEAD^{tree}'));
    expect(existsSync(join(target, 'uncommitted.txt'))).toBe(false);
    const sha = gitIn(target, 'rev-parse', 'HEAD');
    expect(result.stdout).toContain(`committed ${sha} "chore: first public release" by ${AUTHOR} on main in ${target}, with no remote`);
    expect(result.stdout.trimEnd().split('\n')
      .slice(-2)).toEqual(publishCommands(target).map((command) => `  ${command}`));
  });
});
