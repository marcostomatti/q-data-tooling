/**
 * The quoted-code check: a fence whose first line is `// <path>` quotes that file, so the path
 * names an existing file and the file declares every name the block declares. A declaration is an
 * `export const`, a `function` (exported, async or neither), an `interface` or a `type` alias, and
 * it is read by name, not by text: `\s+` between its words crosses line breaks, so a block and its
 * file may wrap a declaration differently. A first line that is not one path, such as a comment in
 * prose, quotes no file; a path holding a placeholder, such as `<plural>`, is skipped by that rule
 * alone. Planning documents (`isPlanningDoc`) quote files their work has yet to create, so they
 * are not scanned.
 *
 * @module
 */

import type { MarkdownDoc } from './markdown';

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { isPlanningDoc, parseMarkdown, readTrackedMarkdown, REPO_ROOT } from './markdown';

/** One markdown text to scan, keyed by its repo-relative posix path. */
interface ScanInput extends Pick<MarkdownDoc, 'fences'> {
  readonly file: string
}

/** Reads a repo-relative path, or `undefined` when no file is there. */
export type ReadSource = (path: string) => string | undefined;

/** What a scan read and what it found wrong. */
interface Scan {
  /** One `file:line path` entry per missing file, or `file:line path name` per missing name. */
  readonly misses: readonly string[]
  /** How many quoting fences and declared names were checked, misses included. */
  readonly checked: { readonly fences: number, readonly names: number }
}

const QUOTED_PATH = /^\/\/ +([\w.@/<>-]+)\s*$/;
const PATH_SHAPE = /\/|^\.?[\w-]+\.\w+$/;
const PLACEHOLDER = /<[^>]*>/;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const DECLARATIONS: readonly RegExp[] = [
  /\bexport\s+const\s+([A-Za-z_$][\w$]*)/g,
  /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/g,
  /\binterface\s+([A-Za-z_$][\w$]*)/g,
  /\btype\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>\s*)?=/g,
];

/** The path a fence's first line quotes, or `undefined` when the line is not one path. */
export function quotedPath(firstLine: string | undefined): string | undefined {
  const path = QUOTED_PATH.exec(firstLine ?? '')?.[1];
  return path !== undefined && PATH_SHAPE.test(path)
    ? path
    : undefined;
}

/** The names a source declares, in order of first appearance, with comment lines left out. */
export function declaredNames(source: string): readonly string[] {
  const code = source.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, '');
  const found = DECLARATIONS.flatMap((pattern) => [...code.matchAll(pattern)].map((m) => ({
    at: m.index,
    name: m[1] ?? '',
  })));
  return [...new Set(found.sort((a, b) => a.at - b.at).map((d) => d.name))];
}

/** Reads a repo-relative file from the checkout, or `undefined` when no file is there. */
export function readFromCheckout(path: string): string | undefined {
  const full = join(REPO_ROOT, path);
  return existsSync(full) && statSync(full).isFile()
    ? readFileSync(full, 'utf8')
    : undefined;
}

/** Pure scan: each fence quoting a file is held to the file `read` returns for its path. */
export function scanQuotedCode(docs: readonly ScanInput[], read: ReadSource): Scan {
  const misses: string[] = [];
  let fences = 0;
  let names = 0;
  for (const doc of docs) {
    for (const fence of doc.fences) {
      const path = quotedPath(fence.firstLine);
      if (path === undefined || PLACEHOLDER.test(path)) continue;
      fences += 1;
      const source = read(path);
      if (source === undefined) {
        misses.push(`${doc.file}:${fence.line} ${path}`);
        continue;
      }
      const inFile = new Set(declaredNames(source));
      for (const name of declaredNames(fence.body.join('\n'))) {
        names += 1;
        if (!inFile.has(name)) misses.push(`${doc.file}:${fence.line} ${path} ${name}`);
      }
    }
  }
  return { misses, checked: { fences, names } };
}

describe('quotedPath', () => {
  test('reads one path, and nothing from a comment in prose', () => {
    expect(quotedPath('// src/a.ts')).toBe('src/a.ts');
    expect(quotedPath('// .mcp.json')).toBe('.mcp.json');
    expect(quotedPath('// src/<plural>/a.ts')).toBe('src/<plural>/a.ts');
    expect(quotedPath('// the client\'s settings, in the usual shape')).toBeUndefined();
    expect(quotedPath('// note')).toBeUndefined();
    expect(quotedPath('const a = 1')).toBeUndefined();
    expect(quotedPath(undefined)).toBeUndefined();
  });
});

describe('declaredNames', () => {
  test('reads each declaration kind, however it wraps', () => {
    const source = [
      'export const\n  WRAPPED = 1',
      'export const Plain = 2',
      'const local = 3',
      'export async function\nasyncOne() {}',
      'function bare() {}',
      'function* gen() {}',
      'export interface Shape {}',
      'export type Alias<T extends string> =\n  T',
      'import type { Log } from \'./log\'',
      'type Input = z.infer<typeof Schema>',
      '// export const Commented = 4',
      '/* function hidden() {} */',
    ].join('\n');

    expect([...declaredNames(source)].sort()).toEqual(
      ['Alias', 'Input', 'Plain', 'Shape', 'WRAPPED', 'asyncOne', 'bare', 'gen'].sort(),
    );
  });
});

describe('scanQuotedCode (failing control)', () => {
  const files: Record<string, string> = {
    'src/a.ts': 'export const\n  Alpha = 1\n\nexport function beta(\n  x: number,\n): number {\n  return x\n}\n',
    'src/b.ts': 'export interface Gamma {}\n',
  };
  const read: ReadSource = (path) => files[path];
  const source = [
    '```ts',
    '// src/a.ts',
    'export const Alpha = 1',
    'export function beta(x: number): number {',
    '```',
    '',
    '```ts',
    '// src/b.ts',
    'export interface Gamma {}',
    'export type Delta = string',
    '```',
    '',
    '```ts',
    '// src/gone.ts',
    'export const Epsilon = 1',
    '```',
    '',
    '```ts',
    '// src/<plural>/a.ts',
    'export const Zeta = 1',
    '```',
    '',
    '```jsonc',
    '// what most clients write',
    '{}',
    '```',
    '',
  ].join('\n');
  const docs = [{ file: 'docs/a.md', ...parseMarkdown(source) }];

  test('reports exactly the planted missing file and missing name', () => {
    const scan = scanQuotedCode(docs, read);

    expect(scan.misses).toEqual(['docs/a.md:7 src/b.ts Delta', 'docs/a.md:13 src/gone.ts']);
    expect(scan.checked).toEqual({ fences: 3, names: 4 });
  });

  test('passes the same fences once the files declare every name', () => {
    const whole: ReadSource = (path) => path === 'src/gone.ts'
      ? 'export const Epsilon = 1\n'
      : `${files[path] ?? ''}export type Delta = string\n`;

    expect(scanQuotedCode(docs, whole).misses).toEqual([]);
  });
});

describe('tracked markdown (real)', () => {
  const scan = scanQuotedCode(readTrackedMarkdown().filter((doc) => !isPlanningDoc(doc.file)), readFromCheckout);

  test('reads quoting fences and their names', () => {
    expect(scan.checked.fences).toBeGreaterThan(0);
    expect(scan.checked.names).toBeGreaterThan(0);
  });

  test('every quoted file exists and declares each name its fence declares', () => {
    expect(scan.misses).toEqual([]);
  });
});
