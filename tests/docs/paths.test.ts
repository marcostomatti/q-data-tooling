/**
 * The paths check: every backticked repository path and every relative link target in a tracked
 * markdown file names a file or folder that exists. A backticked path is read from the checkout
 * root, a link target from the folder of the file that holds it. A path holding a placeholder,
 * such as `<name>` or `<plural>`, is skipped by that rule alone.
 *
 * @module
 */

import type { MarkdownDoc } from './markdown';

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { parseMarkdown, readTrackedMarkdown, REPO_ROOT, resolveLink } from './markdown';

/** One markdown text to scan, keyed by its repo-relative posix path. */
interface ScanInput extends Pick<MarkdownDoc, 'spans' | 'links'> {
  readonly file: string
}

/** The checkout a scan reads: what git tracks, what is on disk, and what git ignores. */
export interface Tree {
  /** Every tracked file and every folder above one, repo-relative, without a trailing slash. */
  readonly paths: ReadonlySet<string>
  /** True when the repo-relative path is on disk, tracked or not. */
  readonly exists: (path: string) => boolean
  /** True when git ignores the path, as a file or a folder, such as build output the docs name. */
  readonly ignored: (path: string) => boolean
}

/** What a scan read and what it found missing. */
interface Scan {
  /** One `file:line path` entry per path that does not exist. */
  readonly misses: readonly string[]
  /** How many backticked paths and link targets were checked, misses included. */
  readonly checked: { readonly spans: number, readonly links: number }
}

const FILE_EXTENSION = /[^./]\.(?:ts|tsx|json|md|sql|toml|lock|yaml|yml|sh|mjs|tsv)$/;
const PLACEHOLDER = /<[^>]*>/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const NOT_A_PATH = /[\s=]/;

/** Every tracked file and every folder above one. */
export function treePaths(files: readonly string[]): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    parts.forEach((_, i) => paths.add(parts.slice(0, i + 1).join('/')));
  }
  return paths;
}

/**
 * True for a span that reads as a repository path: no whitespace or `=`, not absolute, not a
 * flag, a scheme, a home path, a scoped package or an anchor, and either a bare file name with a
 * known extension or a nested path whose first folder is a folder name the checkout holds, so
 * `src/x.ts` and `meta/_journal.json` are paths and `tools/list` and `react-dom/server` are not.
 */
export function isRepoPath(token: string, paths: ReadonlySet<string>): boolean {
  if (NOT_A_PATH.test(token) || SCHEME.test(token)) return false;
  if (['/', '#', '-', '~', '@'].some((lead) => token.startsWith(lead))) return false;
  if (!token.includes('/')) return FILE_EXTENSION.test(token);
  const first = token.split('/')[0] ?? '';
  return first === '.' || first === '..' || [...paths].some((p) => p === first || p.endsWith(`/${first}`));
}

/**
 * True when a backticked path names something in the checkout: a path on disk read from the
 * root, or the tail of a tracked path, so a doc may name `active.ts` after naming its folder.
 */
function spanFound(token: string, tree: Tree): boolean {
  const path = token.replace(/\/$/, '');
  if (tree.exists(path) || tree.paths.has(path)) return true;
  return [...tree.paths].some((p) => p.endsWith(`/${path}`));
}

/** Pure scan: every path in `docs` that `tree` does not hold, and git does not ignore, is a miss. */
export function scanPaths(docs: readonly ScanInput[], tree: Tree): Scan {
  const misses: string[] = [];
  let spans = 0;
  let links = 0;
  for (const doc of docs) {
    for (const span of doc.spans) {
      if (!isRepoPath(span.text, tree.paths) || PLACEHOLDER.test(span.text)) continue;
      spans += 1;
      if (!spanFound(span.text, tree) && !tree.ignored(span.text)) misses.push(`${doc.file}:${span.line} ${span.text}`);
    }
    for (const link of doc.links) {
      if (link.path === '' || PLACEHOLDER.test(link.path)) continue;
      links += 1;
      const target = resolveLink(doc.file, link).replace(/\/$/, '');
      const found = !target.startsWith('..') && (tree.exists(target) || tree.paths.has(target));
      if (!found && !tree.ignored(target)) misses.push(`${doc.file}:${link.line} ${link.target}`);
    }
  }
  return { misses, checked: { spans, links } };
}

/** Runs git in the checkout; exit 1 is an answer, as `check-ignore` gives for a kept path. */
function git(args: readonly string[]): { readonly exitCode: number, readonly stdout: string } {
  const run = Bun.spawnSync(['git', '-C', REPO_ROOT, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode > 1) throw new Error(`git ${args[0]} failed: ${run.stderr.toString().trim()}`);
  return { exitCode: run.exitCode, stdout: run.stdout.toString() };
}

/** The checkout as a scan reads it. */
function repoTree(): Tree {
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout;
  return {
    paths: treePaths(listed.split('\0').filter(Boolean)),
    exists: (path) => !path.startsWith('..') && existsSync(join(REPO_ROOT, path)),
    ignored: (path) => {
      if (path.startsWith('..')) return false;
      const bare = path.replace(/\/$/, '');
      return [bare, `${bare}/`].some((p) => git(['check-ignore', '-q', '--no-index', p]).exitCode === 0);
    },
  };
}

/** A checkout of two tracked files and an ignored build folder, for the synthetic scans. */
const FIXTURE_TREE: Tree = {
  paths: treePaths(['src/real.ts', 'src/data/active.ts', 'docs/real.md']),
  exists: (path) => FIXTURE_TREE.paths.has(path),
  ignored: (path) => path.startsWith('dist'),
};

describe('isRepoPath', () => {
  const { paths } = FIXTURE_TREE;

  test('reads nested paths and bare file names as paths', () => {
    const tokens = ['src/x.ts', 'data/y.ts', './x', 'README.md', 'docker-compose.yaml'];
    expect(tokens.filter((t) => isRepoPath(t, paths))).toEqual(tokens);
  });

  test('rejects commands, flags, urls, packages, settings and absolute paths', () => {
    const tokens = [
      'bun run lint',
      '--no-gitleaks',
      'https://x.dev/a',
      '/db add',
      '#anchor',
      'PORT',
      '.ts',
      '@scope/pkg',
      'react-dom/server',
      'tools/list',
      'KEY=src/x.ts',
      '~/x/y.ts',
    ];
    expect(tokens.filter((t) => isRepoPath(t, paths))).toEqual([]);
  });
});

describe('scanPaths (failing control)', () => {
  const source = [
    'Edit `src/real.ts`, `active.ts` and `src/missing.ts`, see `src/<name>/x.ts` and `dist/`,',
    'run `bun test` and read [real](real.md), [gone](gone.md#top) and [here](#anchor).',
  ].join('\n');
  const docs = [{ file: 'docs/a.md', ...parseMarkdown(source) }];

  test('reports exactly the planted missing span and link', () => {
    const scan = scanPaths(docs, FIXTURE_TREE);

    expect(scan.misses).toEqual(['docs/a.md:1 src/missing.ts', 'docs/a.md:2 gone.md#top']);
    expect(scan.checked).toEqual({ spans: 3, links: 2 });
  });

  test('passes the same text once every path exists', () => {
    const tree: Tree = { ...FIXTURE_TREE, exists: () => true };
    expect(scanPaths(docs, tree).misses).toEqual([]);
  });
});

describe('tracked markdown (real)', () => {
  const scan = scanPaths(readTrackedMarkdown(), repoTree());

  test('reads backticked paths and link targets', () => {
    expect(scan.checked.spans).toBeGreaterThan(0);
    expect(scan.checked.links).toBeGreaterThan(0);
  });

  test('every backticked repository path and relative link target exists', () => {
    expect(scan.misses).toEqual([]);
  });
});
