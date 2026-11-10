import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, describe, expect, test } from 'bun:test';

const ROOT = join(import.meta.dir, '..', '..');
const HOOKS = join(ROOT, '.githooks');
const SCRIPTS = ['privacy-history.sh', 'privacy-check.ts'];

/** Each push runs the scan, which starts bun twice per commit. */
const PUSH_TIMEOUT_MS = 30_000;

/**
 * Joins fragments, so the planted term does not sit whole in this file and make the file a hit
 * of its own.
 */
function joined(...fragments: string[]): string {
  return fragments.join('');
}

const TERM = joined('zorb', 'lequ');
const LABEL = 'placeholder';

const made: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pre-push-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/** A `gitleaks` stand-in that writes an empty JSON report, so the run does not hang on a real one. */
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

/** One stand-in for the whole file, removed after the last test. */
const GITLEAKS_BIN = stubGitleaks();
made.splice(0);
afterAll(() => rmSync(GITLEAKS_BIN, { recursive: true, force: true }));

/**
 * The environment without the variables a git hook sets or a denylist the caller named, with an
 * identity for the commits, the gitleaks stand-in first on `PATH`, and `bun` on it.
 */
function baseEnv(): Record<string, string | undefined> {
  const {
    GIT_DIR: _dir,
    GIT_WORK_TREE: _tree,
    GIT_INDEX_FILE: _index,
    PRIVACY_DENYLIST: _denylist,
    ...rest
  } = process.env;
  return {
    ...rest,
    GIT_AUTHOR_NAME: 'Tester',
    GIT_AUTHOR_EMAIL: 'tester@example.test',
    GIT_COMMITTER_NAME: 'Tester',
    GIT_COMMITTER_EMAIL: 'tester@example.test',
    PATH: `${GITLEAKS_BIN}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
  };
}

type Run = { exitCode: number; stdout: string; stderr: string };

function run(dir: string, args: readonly string[], env: Record<string, string> = {}): Run {
  const result = Bun.spawnSync(['git', '-C', dir, ...args], {
    env: { ...baseEnv(), ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function gitIn(dir: string, ...args: string[]): string {
  const result = run(dir, args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * A clone with a bare `origin`, the hook turned on by `core.hooksPath`, and the two scan scripts
 * copied in untracked, where the hook looks for them, so no commit holds their text.
 */
function clone(): { dir: string; remote: string } {
  const remote = join(tempDir(), 'remote.git');
  gitIn(tempDir(), 'init', '-q', '--bare', remote);
  const dir = tempDir();
  gitIn(dir, 'init', '-q', '-b', 'main');
  gitIn(dir, 'remote', 'add', 'origin', remote);
  gitIn(dir, 'config', 'core.hooksPath', HOOKS);
  mkdirSync(join(dir, 'scripts'));
  SCRIPTS.forEach((name) => copyFileSync(join(ROOT, 'scripts', name), join(dir, 'scripts', name)));
  appendFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.rafa/\n');
  return { dir, remote };
}

function commit(dir: string, file: string, text: string, message: string): string {
  writeFileSync(join(dir, file), text);
  gitIn(dir, 'add', file);
  gitIn(dir, 'commit', '-q', '-m', message);
  return gitIn(dir, 'rev-parse', 'HEAD');
}

/** Writes the denylist at the default path, `.rafa/privacy-denylist.tsv` in the checkout. */
function plantDefaultDenylist(dir: string): void {
  mkdirSync(join(dir, '.rafa'), { recursive: true });
  writeFileSync(join(dir, '.rafa', 'privacy-denylist.tsv'), `word:${LABEL}\t${TERM}\n`);
}

/** A denylist file outside the clone, for `PRIVACY_DENYLIST`. */
function denylistFile(): string {
  const list = join(tempDir(), 'denylist.tsv');
  writeFileSync(list, `word:${LABEL}\t${TERM}\n`);
  return list;
}

/** The sha `ref` names in the bare remote, or `undefined` when it has no such ref. */
function remoteSha(remote: string, ref: string): string | undefined {
  const result = Bun.spawnSync(['git', '--git-dir', remote, 'rev-parse', '--verify', '-q', ref], {
    env: baseEnv(),
    stdout: 'pipe',
  });
  return result.exitCode === 0
    ? result.stdout.toString().trim()
    : undefined;
}

describe('the pre-push privacy hook', () => {
  test('refuses a push whose commit holds a denylisted term, and never prints the term', () => {
    const { dir, remote } = clone();
    plantDefaultDenylist(dir);
    commit(dir, 'a.txt', 'fine\n', 'add a clean file');
    commit(dir, 'b.txt', `the ${TERM} handler\n`, 'add a second file');

    const result = run(dir, ['push', '-q', 'origin', 'main']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('refusing to push refs/heads/main: the scan found private data');
    expect(result.stderr).toContain(`b.txt:1 ${LABEL}`);
    expect(result.stderr).not.toContain(TERM);
    expect(remoteSha(remote, 'refs/heads/main')).toBeUndefined();
  }, PUSH_TIMEOUT_MS);

  test('pushes a clean commit, with the denylist named by PRIVACY_DENYLIST', () => {
    const { dir, remote } = clone();
    const sha = commit(dir, 'a.txt', 'fine\n', 'add a clean file');

    const result = run(dir, ['push', '-q', 'origin', 'main'], { PRIVACY_DENYLIST: denylistFile() });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('no denylist file found');
    expect(remoteSha(remote, 'refs/heads/main')).toBe(sha);
  }, PUSH_TIMEOUT_MS);

  test('lets a deletion through without scanning the ref it deletes', () => {
    const { dir, remote } = clone();
    plantDefaultDenylist(dir);
    commit(dir, 'a.txt', `the ${TERM} handler\n`, 'add a file');
    gitIn(dir, 'push', '-q', '--no-verify', 'origin', 'main:topic');

    const result = run(dir, ['push', '-q', 'origin', '--delete', 'topic']);

    expect(result.exitCode).toBe(0);
    expect(remoteSha(remote, 'refs/heads/topic')).toBeUndefined();
  }, PUSH_TIMEOUT_MS);

  test('in strict mode, refuses a push when the denylist file is missing, and names it', () => {
    const { dir, remote } = clone();
    gitIn(dir, 'config', 'privacy.strict', 'true');
    commit(dir, 'a.txt', 'fine\n', 'add a clean file');

    const result = run(dir, ['push', '-q', 'origin', 'main']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('strict mode: the denylist file is missing');
    expect(result.stderr).not.toContain('gitleaks is missing');
    expect(remoteSha(remote, 'refs/heads/main')).toBeUndefined();
  }, PUSH_TIMEOUT_MS);

  test('without strict mode, pushes with no denylist and says it skipped one', () => {
    const { dir, remote } = clone();
    const sha = commit(dir, 'a.txt', 'fine\n', 'add a clean file');

    const result = run(dir, ['push', '-q', 'origin', 'main']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('no denylist file found, so the scan runs without one');
    expect(remoteSha(remote, 'refs/heads/main')).toBe(sha);
  }, PUSH_TIMEOUT_MS);

  test('scans only the commits the remote lacks, for an existing branch and for a new one', () => {
    const { dir, remote } = clone();
    plantDefaultDenylist(dir);
    commit(dir, 'a.txt', `the ${TERM} handler\n`, 'add a file');
    gitIn(dir, 'push', '-q', '--no-verify', 'origin', 'main');
    gitIn(dir, 'fetch', '-q', 'origin');
    gitIn(dir, 'remote', 'set-head', 'origin', 'main');
    const onMain = commit(dir, 'b.txt', 'fine\n', 'add a clean file');
    gitIn(dir, 'switch', '-q', '-c', 'topic');
    const onTopic = commit(dir, 'c.txt', 'fine too\n', 'add another clean file');

    const existing = run(dir, ['push', '-q', 'origin', 'main']);
    const fresh = run(dir, ['push', '-q', 'origin', 'topic']);

    expect(existing.exitCode).toBe(0);
    expect(fresh.exitCode).toBe(0);
    expect(remoteSha(remote, 'refs/heads/main')).toBe(onMain);
    expect(remoteSha(remote, 'refs/heads/topic')).toBe(onTopic);
  }, PUSH_TIMEOUT_MS);

  test('scans a new tag like a new branch', () => {
    const { dir, remote } = clone();
    plantDefaultDenylist(dir);
    commit(dir, 'a.txt', `the ${TERM} handler\n`, 'add a file');
    gitIn(dir, 'tag', '-a', '-m', 'first', 'v1');

    const result = run(dir, ['push', '-q', 'origin', 'v1']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('refusing to push refs/tags/v1');
    expect(remoteSha(remote, 'refs/tags/v1')).toBeUndefined();
  }, PUSH_TIMEOUT_MS);
});
