import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'privacy-history.sh');

/**
 * Joins fragments, so a fixture that must hit a rule does not sit whole in this file and make the
 * file a hit of its own.
 */
function joined(...fragments: string[]): string {
  return fragments.join('');
}

const THING = joined('thi', 'ng');
const PRIVATE_IP = joined('10', '.0.0.1');

const made: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-history-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/**
 * The environment without the variables a git hook sets or a denylist the caller named, with an
 * identity for the commits and `bun` on `PATH`.
 */
function baseEnv(path: string): Record<string, string | undefined> {
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
    PATH: `${path}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
  };
}

function gitIn(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', dir, ...args], { env: baseEnv(''), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** A fresh repository with no commits. */
function repo(): string {
  const dir = tempDir();
  gitIn(dir, 'init', '-q');
  return dir;
}

/** Writes the file, commits it with the message, and returns the commit's 12-character sha. */
function commit(dir: string, file: string, text: string, message: string): string {
  writeFileSync(join(dir, file), text);
  gitIn(dir, 'add', file);
  gitIn(dir, 'commit', '-q', '--no-verify', '-m', message);
  return gitIn(dir, 'rev-parse', 'HEAD').slice(0, 12);
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

/** The line a stand-in config carries to allow the stand-in's one finding. */
const ALLOW_LINE = 'allow-the-made-up-key';

/**
 * A `gitleaks` stand-in that reads its config the way gitleaks does, from `--config` first and
 * else from the `.gitleaks.toml` in the folder it scans. It reports one `generic-api-key` hit on
 * `a.txt` line 1 unless that config holds {@link ALLOW_LINE}.
 */
function configAwareGitleaks(): string {
  const bin = tempDir();
  const stub = join(bin, 'gitleaks');
  writeFileSync(stub, [
    '#!/bin/sh',
    'for dir in "$@"; do :; done',
    'config="$dir/.gitleaks.toml"',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    --config) config="$2"; shift ;;',
    '    --report-path) report="$2"; shift ;;',
    '  esac',
    '  shift',
    'done',
    `if [ -f "$dir/a.txt" ] && ! grep -qs '${ALLOW_LINE}' "$config"; then`,
    '  printf \'[{"File":"%s/a.txt","StartLine":1,"RuleID":"generic-api-key"}]\' "$dir" > "$report"',
    'else',
    '  printf "[]" > "$report"',
    'fi',
    '',
  ].join('\n'));
  chmodSync(stub, 0o755);
  return bin;
}

/** A denylist file whose one `word:` rule hits the placeholder word. */
function denylist(): string {
  const list = join(tempDir(), 'denylist.tsv');
  writeFileSync(list, `word:placeholder\t${THING}\n`);
  return list;
}

type Run = { exitCode: number; stdout: string; stderr: string };

function history(
  dir: string,
  args: readonly string[],
  env: Record<string, string> = {},
  gitleaksBin: string = stubGitleaks(),
): Run {
  const result = Bun.spawnSync(['bash', SCRIPT, ...args], {
    cwd: dir,
    env: { ...baseEnv(gitleaksBin), ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe('the commit message scan', () => {
  test('a message holding a denylisted word is reported as commit <sha> message <label>', () => {
    const dir = repo();
    commit(dir, 'a.txt', 'fine\n', 'add a clean file');
    const sha = commit(dir, 'b.txt', 'fine too\n', joined('add the ', THING, ' handler\n\nmore about the ', THING));

    const result = history(dir, ['HEAD', '--denylist', denylist()]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`commit ${sha} message placeholder\n`);
    expect(result.stdout).not.toContain(THING);
  });

  test('a clean message and clean files report nothing, so the message finding is the message', () => {
    const dir = repo();
    commit(dir, 'a.txt', 'fine\n', 'add a clean file');
    commit(dir, 'b.txt', 'fine too\n', 'add another clean file');

    const result = history(dir, ['HEAD', '--denylist', denylist()]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  test('a message is read by the generic rules too, and the denylist may come from PRIVACY_DENYLIST', () => {
    const dir = repo();
    const sha = commit(dir, 'a.txt', 'fine\n', joined('reach the host at ', PRIVATE_IP, ', the ', THING));

    const result = history(dir, ['HEAD'], { PRIVACY_DENYLIST: denylist() });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`commit ${sha} message placeholder\ncommit ${sha} message private-ip\n`);
  });
});

describe('the file scan', () => {
  test('a file a later commit removes is still found, under its commit, and the range is honoured', () => {
    const dir = repo();
    const base = commit(dir, 'a.txt', `${PRIVATE_IP}\n`, 'add a file');
    const added = commit(dir, 'b.txt', `fine\n${PRIVATE_IP}\n`, 'add a second file');
    gitIn(dir, 'rm', '-q', 'b.txt');
    gitIn(dir, 'commit', '-q', '--no-verify', '-m', 'remove the second file');

    const all = history(dir, ['HEAD']);
    const later = history(dir, [`${base}..HEAD`]);

    expect(all.exitCode).toBe(1);
    expect(all.stdout).toBe(`commit ${base}:\na.txt:1 private-ip\n1 finding(s) (no denylist)\n`
      + `commit ${added}:\nb.txt:2 private-ip\n1 finding(s) (no denylist)\n`);
    expect(later.stdout).toBe(`commit ${added}:\nb.txt:2 private-ip\n1 finding(s) (no denylist)\n`);
  });
});

describe('the gitleaks config', () => {
  test('a commit that changes a file and not .gitleaks.toml is scanned with the .gitleaks.toml it holds', () => {
    const dir = repo();
    commit(dir, '.gitleaks.toml', `${ALLOW_LINE}\n`, 'add the gitleaks config');
    commit(dir, 'a.txt', 'the first version\n', 'add the allowed file');
    commit(dir, 'a.txt', 'the second version\n', 'change the allowed file alone');

    const result = history(dir, ['HEAD'], {}, configAwareGitleaks());

    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });

  test('a commit holding no .gitleaks.toml is scanned with the default rules, so the hit is reported', () => {
    const dir = repo();
    const sha = commit(dir, 'a.txt', 'a version\n', 'add a file with no config');

    const result = history(dir, ['HEAD'], {}, configAwareGitleaks());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(`commit ${sha}:\na.txt:1 gitleaks:generic-api-key\n1 finding(s) (no denylist)\n`);
  });
});

describe('the command', () => {
  test('under --no-gitleaks the last line, printed once, is gitleaks did not run', () => {
    const dir = repo();
    const sha = commit(dir, 'a.txt', `${PRIVATE_IP}\n`, joined('the ', THING));

    const found = history(dir, ['HEAD', '--no-gitleaks', '--denylist', denylist()]);

    expect(found.exitCode).toBe(1);
    expect(found.stdout).toBe(`commit ${sha}:\na.txt:1 private-ip\n1 finding(s)\n`
      + `commit ${sha} message placeholder\ngitleaks did not run\n`);
  });

  test('exits 2 for a malformed denylist, a range git cannot read, or no range at all', () => {
    const dir = repo();
    commit(dir, 'a.txt', 'fine\n', 'add a clean file');
    const list = join(tempDir(), 'denylist.tsv');
    writeFileSync(list, 'no tab here\n');

    const malformed = history(dir, ['HEAD', '--denylist', list]);

    expect(malformed.exitCode).toBe(2);
    expect(malformed.stdout).toContain('no tab between label and regex');
    expect(history(dir, ['no-such-ref']).exitCode).toBe(2);
    expect(history(dir, []).exitCode).toBe(2);
    expect(history(dir, ['HEAD', '--unknown']).exitCode).toBe(2);
  });
});
