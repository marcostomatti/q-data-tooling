import type { Finding, Rule } from '../../scripts/privacy-check.ts';

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import {
  ALLOWED_EMAILS,
  GENERIC_RULES,
  inWorkTree,
  isLockfile,
  isWorkflow,
  parseDenylist,
  scanDir,
  scanText,
  withoutAllowed,
  wordLineOf,
  words,
} from '../../scripts/privacy-check.ts';

const SCRIPT = join(import.meta.dir, '..', '..', 'scripts', 'privacy-check.ts');

/**
 * Joins fragments, so a fixture that must hit a rule does not sit whole in this file and make the
 * file a hit of its own. The placeholder words are split the same way, in case a real denylist
 * names one of them.
 */
function joined(...fragments: string[]): string {
  return fragments.join('');
}

const THING = joined('thi', 'ng');
const TAIL_WORD = joined('sc', 'ore');

/** The labels of the generic rules that hit a one-line text. */
function genericHits(line: string): readonly string[] {
  return scanText('f.txt', line, GENERIC_RULES).map((finding) => finding.rule);
}

/** The labels of the rules that hit a one-line text. */
function hits(line: string, rules: readonly Rule[]): readonly string[] {
  return scanText('f.txt', line, rules).map((finding) => finding.rule);
}

const made: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-check-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

/** The environment without the variables a git hook sets, so git finds the folder it is given. */
function gitEnv(): Record<string, string | undefined> {
  const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_INDEX_FILE: _index, ...rest } = process.env;
  return rest;
}

function gitIn(dir: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', '-C', dir, ...args], { env: gitEnv(), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
}

/** A fresh repository, its files written but not committed, its `.gitignore` as given. */
function repo(gitignore: string): string {
  const dir = tempDir();
  gitIn(dir, 'init', '-q');
  writeFileSync(join(dir, '.gitignore'), gitignore);
  return dir;
}

const PRIVATE_IP = joined('10', '.0.0.1');

/** The findings sorted by file, a file's own findings left in the order the scan gave them. */
const byFile = (findings: readonly Finding[]): readonly Finding[] => [...findings]
  .sort((a, b) => a.file.localeCompare(b.file));

describe('the generic rules', () => {
  test('an address in 10/8 is a private-ip hit, and the documentation address 192.0.2.9 is not', () => {
    expect(genericHits(`host ${joined('10', '.', '1.2.3')} up`)).toEqual(['private-ip']);
    expect(genericHits('host 192.0.2.9 up')).toEqual([]);
  });

  test('the other private ranges hit, and a public address beside them does not', () => {
    expect(genericHits(joined('172', '.20.1.1'))).toEqual(['private-ip']);
    expect(genericHits(joined('192', '.168.0.1'))).toEqual(['private-ip']);
    expect(genericHits(joined('100', '.64.0.1'))).toEqual(['private-ip']);
    expect(genericHits('198.51.100.7')).toEqual([]);
  });

  test('a named home folder is a home-path hit, and the placeholder users are not', () => {
    expect(genericHits(joined('/ho', 'me/alice/project'))).toEqual(['home-path']);
    expect(genericHits(joined('/Us', 'ers/alice/project'))).toEqual(['home-path']);
    expect(genericHits('/home/user/project and /home/runner/work and /Users/tester/x')).toEqual([]);
  });

  test('a free-mail address is an email hit, and a@example.test is not', () => {
    expect(genericHits(joined('mail someone@', 'gmail', '.com today'))).toEqual(['email']);
    expect(genericHits('mail a@example.test today')).toEqual([]);
  });

  test('every reserved domain, the example domains and no-reply addresses are allowed', () => {
    const allowed = [
      'a@site.example',
      'a@x.invalid',
      'a@app.localhost',
      'a@example.com',
      'a@example.org',
      '1+a@users.noreply.github.com',
      'noreply@service.dev',
    ];
    allowed.forEach((address) => expect(genericHits(address)).toEqual([]));
  });

  test('no address is allowed by name', () => {
    expect(ALLOWED_EMAILS).toEqual([]);
  });

  test('a bot token is a telegram-token hit, and one character short is not', () => {
    expect(genericHits(joined('123456789', ':', 'A'.repeat(35)))).toEqual(['telegram-token']);
    expect(genericHits(joined('123456789', ':', 'A'.repeat(34)))).toEqual([]);
  });

  test('a supergroup id is a telegram-chat hit, and one digit short is not', () => {
    expect(genericHits(joined('chat ', '-100', '123456789'))).toEqual(['telegram-chat']);
    expect(genericHits(joined('chat ', '-100', '12345678'))).toEqual([]);
  });
});

describe('the tokenizer', () => {
  test('cuts at non-letters and at a lower-to-upper case change', () => {
    expect(words('addThing some_thing x-y-z HTTPServer')).toEqual(['add', 'Thing', 'some', 'thing', 'x', 'y', 'z', 'HTTPServer']);
  });

  test('takes an allowed phrase out in any case and leaves the rest of the line', () => {
    expect(withoutAllowed(`a Cron ${THING.toUpperCase()} and a ${THING}`, [`cron ${THING}`]))
      .toBe(`a   and a ${THING}`);
  });
});

describe('the denylist', () => {
  test('a label<TAB>regex line is a rule matched case-insensitively', () => {
    const rules = parseDenylist(`# a comment\n\nproject-name\t${THING}s?\n`);
    expect(rules).toHaveLength(1);
    expect(hits(`the ${THING.toUpperCase()} here`, rules)).toEqual(['project-name']);
    expect(hits('nothing to see', rules)).toEqual(['project-name']);
  });

  test('a word: rule hits a word inside camelCase and after an underscore', () => {
    const rules = parseDenylist(`word:placeholder\t${THING}|other`);
    expect(hits(joined('const add', 'Thi', 'ng = 1'), rules)).toEqual(['placeholder']);
    expect(hits(joined('const some_', THING, ' = 1'), rules)).toEqual(['placeholder']);
  });

  test('a word: rule does not hit a word that only contains its word', () => {
    const rules = parseDenylist(`word:placeholder\t${TAIL_WORD}`);
    expect(hits('an underscore in a name', rules)).toEqual([]);
    expect(hits(`the ${TAIL_WORD}s are in`, rules)).toEqual(['placeholder']);
  });

  test('an allow phrase removes only itself, and the same word elsewhere on the line still hits', () => {
    const rules = parseDenylist(`word:placeholder\t${THING}\nallow\tcron ${THING}\n`);
    expect(hits(`a cron ${THING} runs nightly`, rules)).toEqual([]);
    expect(hits(`a cron ${THING} and a ${THING}`, rules)).toEqual(['placeholder']);
    expect(hits(`a ${THING} alone`, rules)).toEqual(['placeholder']);
  });

  test('an allow line before its word: rule applies to it too', () => {
    const rules = parseDenylist(`allow\tcron ${THING}\nword:placeholder\t${THING}\n`);
    expect(hits(`a cron ${THING} runs nightly`, rules)).toEqual([]);
  });

  test('an allow phrase does not reach a label<TAB>regex rule', () => {
    const rules = parseDenylist(`allow\tcron ${THING}\nplain\t${THING}\n`);
    expect(hits(`a cron ${THING} runs nightly`, rules)).toEqual(['plain']);
  });

  test('in a workflow, a word: rule does not read a top-level key and still reads the rest', () => {
    const rules = parseDenylist(`word:placeholder\t${THING}\nplain\t${THING}\n`);
    const workflow = '.github/workflows/ci.yml';
    const labels = (file: string, line: string): readonly string[] => scanText(file, line, rules)
      .map((finding) => finding.rule);
    expect(labels(workflow, `${THING}s:`)).toEqual(['plain']);
    expect(labels(workflow, `${THING}s: the ${THING}`)).toEqual(['placeholder', 'plain']);
    expect(labels(workflow, `  ${THING}s:`)).toEqual(['placeholder', 'plain']);
    expect(labels('docs/ci.yml', `${THING}s:`)).toEqual(['placeholder', 'plain']);
  });

  test('a workflow is a .yml or .yaml file in .github/workflows/, and only its line loses the key', () => {
    expect(isWorkflow('.github/workflows/ci.yml')).toBe(true);
    expect(isWorkflow('out/.github/workflows/privacy.yaml')).toBe(true);
    expect(isWorkflow('.github/workflows/notes.md')).toBe(false);
    expect(isWorkflow('.github/ISSUE_TEMPLATE/spec.yml')).toBe(false);
    expect(wordLineOf('.github/workflows/ci.yml', 'on: # a comment')).toBe('  # a comment');
    expect(wordLineOf('src/a.yml', 'on: # a comment')).toBe('on: # a comment');
  });

  test('a malformed line is an error naming its line number', () => {
    expect(() => parseDenylist('fine\tx\nno tab here')).toThrow('denylist line 2: no tab between label and regex');
    expect(() => parseDenylist('bad\t(')).toThrow('denylist line 1:');
    expect(() => parseDenylist('word:bad\t(')).toThrow('denylist line 1:');
    expect(() => parseDenylist('word:\tx')).toThrow('denylist line 1: a word: rule needs a label');
    expect(() => parseDenylist('allow\t ')).toThrow('denylist line 1: an allow line needs a phrase');
  });
});

describe('scanDir', () => {
  test('reads an export folder outside any work tree whole, node_modules too, and reports binaries and symlinks once', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.txt'), `fine\n${PRIVATE_IP}\nfine\n`);
    writeFileSync(join(dir, 'clean.txt'), 'host 192.0.2.9\n');
    writeFileSync(join(dir, 'blob.bin'), new Uint8Array([1, 0, 2]));
    symlinkSync('clean.txt', join(dir, 'link.txt'));
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'read.txt'), PRIVATE_IP);
    writeFileSync(join(dir, '.gitignore'), 'sub/\nnode_modules/\n');

    expect(inWorkTree(dir)).toBe(false);
    expect(byFile(await scanDir(dir, GENERIC_RULES))).toEqual([
      { file: 'blob.bin', line: 0, rule: 'binary-unreviewed' },
      { file: 'link.txt', line: 0, rule: 'symlink-unreviewed' },
      { file: join('node_modules', 'read.txt'), line: 1, rule: 'private-ip' },
      { file: join('sub', 'a.txt'), line: 2, rule: 'private-ip' },
    ]);
  });

  test('in a work tree an ignored folder is left unread, and an untracked or force-added file is read', async () => {
    const dir = repo('ignored/\n');
    mkdirSync(join(dir, 'ignored'));
    writeFileSync(join(dir, 'ignored', 'left.txt'), PRIVATE_IP);
    writeFileSync(join(dir, 'ignored', 'forced.txt'), PRIVATE_IP);
    gitIn(dir, 'add', '-f', 'ignored/forced.txt');
    writeFileSync(join(dir, 'untracked.txt'), PRIVATE_IP);

    expect(inWorkTree(dir)).toBe(true);
    expect(byFile(await scanDir(dir, GENERIC_RULES))).toEqual([
      { file: 'ignored/forced.txt', line: 1, rule: 'private-ip' },
      { file: 'untracked.txt', line: 1, rule: 'private-ip' },
    ]);
  });

  test('an export folder its work tree ignores is read whole', async () => {
    const dir = repo('.tmp/\n');
    const exported = join(dir, '.tmp', 'export');
    mkdirSync(join(exported, 'node_modules'), { recursive: true });
    writeFileSync(join(exported, 'a.txt'), PRIVATE_IP);
    writeFileSync(join(exported, 'node_modules', 'b.txt'), PRIVATE_IP);
    writeFileSync(join(exported, '.gitignore'), 'node_modules/\n');

    expect(inWorkTree(join(dir, '.tmp'))).toBe(false);
    expect(byFile(await scanDir(exported, GENERIC_RULES))).toEqual([
      { file: 'a.txt', line: 1, rule: 'private-ip' },
      { file: join('node_modules', 'b.txt'), line: 1, rule: 'private-ip' },
    ]);
  });

  test('a lockfile is skipped by a word: rule and still read by the others', async () => {
    const dir = tempDir();
    const rules = [...GENERIC_RULES, ...parseDenylist(`word:placeholder\t${THING}\n`)];
    const line = `"${joined('add', 'Thi', 'ng')}": "1.0.0", "host": "${PRIVATE_IP}"\n`;
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'bun.lock'), line);
    writeFileSync(join(dir, 'sub', 'package-lock.json'), line);
    writeFileSync(join(dir, 'package.json'), line);

    expect(isLockfile('sub/package-lock.json')).toBe(true);
    expect(isLockfile('package.json')).toBe(false);
    expect(byFile(await scanDir(dir, rules))).toEqual([
      { file: 'bun.lock', line: 1, rule: 'private-ip' },
      { file: 'package.json', line: 1, rule: 'private-ip' },
      { file: 'package.json', line: 1, rule: 'placeholder' },
      { file: join('sub', 'package-lock.json'), line: 1, rule: 'private-ip' },
    ]);
  });

  test('a reviewed binary passes while its hash matches, and a changed one is reported', async () => {
    const dir = tempDir();
    const bytes = new Uint8Array([1, 0, 2]);
    writeFileSync(join(dir, 'blob.bin'), bytes);
    const hash = new Bun.CryptoHasher('sha256').update(bytes)
      .digest('hex');

    expect(await scanDir(dir, GENERIC_RULES, new Map([['blob.bin', hash]]))).toEqual([]);
    expect(await scanDir(dir, GENERIC_RULES, new Map([['blob.bin', '0'.repeat(64)]])))
      .toEqual([{ file: 'blob.bin', line: 0, rule: 'binary-unreviewed' }]);
  });
});

describe('the command', () => {
  /** A `gitleaks` stand-in on `PATH` that writes an empty JSON report, as no gitleaks is installed. */
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

  /**
   * A `gitleaks` stand-in that reports every file of the folder it is asked to scan, one `listed`
   * finding each, and writes that folder's path to `seen` beside itself.
   */
  function listingGitleaks(): string {
    const bin = tempDir();
    const stub = join(bin, 'gitleaks');
    writeFileSync(stub, [
      '#!/bin/sh',
      'for arg; do folder="$arg"; done',
      'while [ $# -gt 0 ]; do',
      '  if [ "$1" = "--report-path" ]; then report="$2"; fi',
      '  shift',
      'done',
      `printf '%s' "$folder" > '${join(bin, 'seen')}'`,
      '{',
      '  printf "["',
      '  sep=""',
      '  /usr/bin/find "$folder" -type f | while IFS= read -r file; do',
      '    printf \'%s{"File":"%s","StartLine":1,"RuleID":"listed"}\' "$sep" "$file"',
      '    sep=","',
      '  done',
      '  printf "]"',
      '} > "$report"',
      '',
    ].join('\n'));
    chmodSync(stub, 0o755);
    return bin;
  }

  /** A folder on `PATH` holding only `git`, so a run finds git and no gitleaks on any host. */
  function gitOnly(): string {
    const bin = tempDir();
    const found = Bun.which('git');
    if (found === null) throw new Error('git is not on PATH');
    symlinkSync(found, join(bin, 'git'));
    return bin;
  }

  type Run = { exitCode: number; stdout: string; stderr: string };

  type RunOptions = { gitleaks?: boolean; stub?: string };

  function run(args: readonly string[], { gitleaks = true, stub }: RunOptions = {}): Run {
    const { PRIVACY_DENYLIST: _denylist, ...inherited } = gitEnv();
    const path = gitleaks
      ? `${stub ?? stubGitleaks()}:${gitOnly()}`
      : gitOnly();
    const env = { ...inherited, PATH: path };
    const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  }

  test('prints a finding as file:line label without the matched text, and exits 1', () => {
    const dir = tempDir();
    const word = joined('place', 'holder');
    writeFileSync(join(dir, 'a.txt'), `fine\nsee ${word}\n`);
    const list = join(tempDir(), 'denylist.tsv');
    writeFileSync(list, `word:label-one\t${word}\n`);

    const result = run([dir, '--denylist', list]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('a.txt:2 label-one\n1 finding(s)\n');
    expect(result.stdout).not.toContain(word);
  });

  test('exits 0 on a clean folder and says no denylist was given', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'host 192.0.2.9\n');

    const result = run([dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('0 finding(s) (no denylist)\n');
  });

  test('exits 2 when the folder does not exist or the denylist is malformed', () => {
    const list = join(tempDir(), 'denylist.tsv');
    writeFileSync(list, 'no tab here\n');

    expect(run([join(tempDir(), 'missing')]).exitCode).toBe(2);
    expect(run([tempDir(), '--denylist', list]).exitCode).toBe(2);
  });

  test('exits 2 naming the flag when --gitleaks-config has no file or names a missing one', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'fine\n');

    const bare = run([dir, '--gitleaks-config']);
    const missing = run([dir, '--gitleaks-config', join(tempDir(), 'missing.toml')]);

    expect(bare.exitCode).toBe(2);
    expect(bare.stderr).toContain('--gitleaks-config needs a file');
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('the gitleaks config file named does not exist');
  });

  test('exits 2 naming --no-gitleaks when gitleaks is missing from PATH, and 0 once it is there', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), 'host 192.0.2.9\n');

    const missing = run([dir], { gitleaks: false });

    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('gitleaks is not on PATH');
    expect(missing.stderr).toContain('--no-gitleaks');
    expect(missing.stdout).toBe('');
    expect(run([dir]).exitCode).toBe(0);
  });

  test('under --no-gitleaks scans without gitleaks and prints gitleaks did not run as the last line', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.txt'), `${PRIVATE_IP}\n`);
    const clean = tempDir();

    const found = run([dir, '--no-gitleaks'], { gitleaks: false });
    const none = run([clean, '--no-gitleaks'], { gitleaks: false });

    expect(found.exitCode).toBe(1);
    expect(found.stdout).toBe('a.txt:1 private-ip\n1 finding(s) (no denylist)\ngitleaks did not run\n');
    expect(none.exitCode).toBe(0);
    const lines = none.stdout.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe('gitleaks did not run');
    expect(run([clean]).stdout).not.toContain('gitleaks did not run');
  });

  test('in a work tree gitleaks reads a copy of what git would track, and the copy is removed', () => {
    const dir = repo('.env\n.tmp/\n');
    writeFileSync(join(dir, 'a.txt'), 'fine\n');
    writeFileSync(join(dir, '.env'), 'fine\n');
    mkdirSync(join(dir, '.tmp'));
    writeFileSync(join(dir, '.tmp', 'big.json'), '{}\n');
    const bin = listingGitleaks();

    const result = run([dir], { stub: bin });
    const scanned = readFileSync(join(bin, 'seen'), 'utf8');

    expect(result.stderr).toBe('');
    expect(result.stdout)
      .toBe('.gitignore:1 gitleaks:listed\na.txt:1 gitleaks:listed\n2 finding(s) (no denylist)\n');
    expect(scanned).not.toBe(dir);
    expect(existsSync(scanned)).toBe(false);
  });

  test('outside a work tree gitleaks reads the folder whole', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'fine\n');

    const result = run([dir], { stub: listingGitleaks() });

    expect(result.stdout).toBe('.env:1 gitleaks:listed\n1 finding(s) (no denylist)\n');
  });
});
