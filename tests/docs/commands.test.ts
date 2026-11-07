/**
 * The commands check: every `bun run <name>` in a tracked markdown file names a script of
 * `package.json`, and every script of `package.json` has a row in the commands table of
 * `docs/setup.md`, the table under its `Commands` heading.
 *
 * A command is read from prose, from a table row and from a fence's body. Prose is read a block at
 * a time, a run of prose lines joined by spaces, because hand-wrapped prose can break a command
 * between its words. A flag after `bun run` is skipped, and `--cwd` with its folder. A name holding
 * a placeholder, such as `<name>`, is skipped by that rule alone, and so is a name holding a `/`,
 * which `bun run` reads as a file to run rather than a script.
 *
 * @module
 */

import type { MarkdownDoc, MarkdownLine } from './markdown';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { parseMarkdown, readTrackedMarkdown, REPO_ROOT } from './markdown';

/** One markdown text to scan, keyed by its repo-relative posix path. */
interface ScanInput extends Pick<MarkdownDoc, 'prose' | 'tableRows' | 'fences'> {
  readonly file: string
}

/** What a scan read and what it found missing. */
interface Scan {
  /** One `file:line name` entry per command that names no script. */
  readonly misses: readonly string[]
  /** How many commands were checked, misses included. */
  readonly checked: number
}

/** A run of text to read commands from, and the line each of its offsets is on. */
interface Segment {
  readonly text: string
  readonly lineAt: (offset: number) => number
}

const BUN_RUN = /\bbun\s+run\s+(?:(?:--cwd\s+\S+|-[\w-]+(?:=\S*)?)\s+)*(\S+)/g;
const PLACEHOLDER = /<[^>]*>/;
const TRAILING = /[`'"),.;:]+$/;

/** One prose block as a segment: its lines joined by spaces, each offset mapped to its line. */
function proseSegment(lines: readonly MarkdownLine[]): Segment {
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.text.length + 1;
  }
  return {
    text: lines.map((line) => line.text).join(' '),
    lineAt: (at) => lines[starts.findLastIndex((start) => start <= at)]?.line ?? 0,
  };
}

/** The runs of consecutive prose lines of one file. */
function proseBlocks(prose: readonly MarkdownLine[]): readonly (readonly MarkdownLine[])[] {
  const blocks: MarkdownLine[][] = [];
  for (const line of prose) {
    const block = blocks.at(-1);
    const last = block?.at(-1);
    if (block !== undefined && last !== undefined && line.line === last.line + 1) block.push(line);
    else blocks.push([line]);
  }
  return blocks;
}

/** The text of each prose block, each table row and each fence body line, with its lines. */
function segments(doc: ScanInput): readonly Segment[] {
  const rows = doc.tableRows.map((row): Segment => ({ text: row.text, lineAt: () => row.line }));
  const fenced = doc.fences.flatMap((fence) => fence.body.map((text, i): Segment => ({
    text,
    lineAt: () => fence.line + 1 + i,
  })));
  return [...proseBlocks(doc.prose).map(proseSegment), ...rows, ...fenced];
}

/** The script name a `bun run` token names, or `undefined` for a placeholder or a file path. */
function scriptName(token: string): string | undefined {
  const name = token.replace(TRAILING, '');
  if (name === '' || PLACEHOLDER.test(token) || name.includes('/')) return undefined;
  return name;
}

/** Each `bun run` command in one segment, as its line and the script name it runs. */
function commandsIn(segment: Segment): readonly { readonly line: number, readonly name: string }[] {
  return [...segment.text.matchAll(BUN_RUN)].flatMap((match) => {
    const name = scriptName(match[1] ?? '');
    return name === undefined
      ? []
      : [{ line: segment.lineAt(match.index), name }];
  });
}

/** Pure scan: every `bun run <name>` in `docs` is read against the script names in `scripts`. */
export function scanCommands(docs: readonly ScanInput[], scripts: ReadonlySet<string>): Scan {
  const misses: string[] = [];
  let checked = 0;
  for (const doc of docs) {
    for (const segment of segments(doc)) {
      for (const { line, name } of commandsIn(segment)) {
        checked += 1;
        if (!scripts.has(name)) misses.push(`${doc.file}:${line} ${name}`);
      }
    }
  }
  return { misses, checked };
}

/**
 * The script names the commands table lists: the first cell of each body row of the first table
 * under the `Commands` heading, backticks taken off; `undefined` when the heading is missing.
 */
export function commandsTableNames(doc: Pick<MarkdownDoc, 'headings' | 'tableRows'>): readonly string[] | undefined {
  const index = doc.headings.findIndex((h) => h.text === 'Commands');
  const heading = doc.headings[index];
  if (heading === undefined) return undefined;
  const end = doc.headings[index + 1]?.line ?? Number.POSITIVE_INFINITY;
  const rows = doc.tableRows.filter((row) => row.line > heading.line && row.line < end);
  return rows
    .slice(1)
    .filter((row) => !row.delimiter)
    .map((row) => (row.cells[0] ?? '').replace(/`/g, ''));
}

/** The scripts the commands table does not list, in `package.json` order. */
export function missingFromTable(scripts: readonly string[], listed: readonly string[]): readonly string[] {
  const names = new Set(listed);
  return scripts.filter((script) => !names.has(script));
}

/** The script names of the checkout's `package.json`, in file order. */
function packageScripts(): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  return Object.keys(manifest.scripts ?? {});
}

describe('scanCommands (failing control)', () => {
  const source = [
    '# Here',
    '',
    'Run `bun run serve`, then bun run lint:fix. A wrapped one: bun',
    'run gone, and `bun run lost -- --x`.',
    '',
    '| Script | Note |',
    '| --- | --- |',
    '| `a` | `bun run absent` |',
    '',
    '```sh',
    'bun run --cwd /some/clone missing',
    'bun run --silent serve',
    'bun run <name>',
    'bun run scripts/x.ts',
    '```',
  ].join('\n');
  const docs = [{ file: 'docs/a.md', ...parseMarkdown(source) }];

  test('reports exactly the planted unknown scripts', () => {
    const scan = scanCommands(docs, new Set(['serve', 'lint:fix']));

    expect(scan.misses).toEqual([
      'docs/a.md:3 gone',
      'docs/a.md:4 lost',
      'docs/a.md:8 absent',
      'docs/a.md:11 missing',
    ]);
    expect(scan.checked).toBe(7);
  });

  test('passes the same commands once every name is a script', () => {
    const scripts = new Set(['serve', 'lint:fix', 'gone', 'lost', 'absent', 'missing']);
    expect(scanCommands(docs, scripts).misses).toEqual([]);
  });
});

describe('commandsTableNames (failing control)', () => {
  const setup = parseMarkdown([
    '# Setup',
    '',
    '| Variable | Default |',
    '| --- | --- |',
    '| `serve` | unset |',
    '',
    '## Commands',
    '',
    '| Script | Runs |',
    '| --- | --- |',
    '| `lint` | `eslint .` |',
    '| `serve` | `bun src/http/server.ts` |',
    '',
    '## The gates',
    '',
    '| Script | Runs |',
    '| --- | --- |',
    '| `mcp` | `bun src/mcp/server.ts` |',
  ].join('\n'));

  test('reads only the body rows of the table under the Commands heading', () => {
    expect(commandsTableNames(setup)).toEqual(['lint', 'serve']);
  });

  test('reports exactly the scripts the table leaves out', () => {
    const listed = commandsTableNames(setup) ?? [];
    expect(missingFromTable(['lint', 'mcp', 'serve', 'typecheck'], listed)).toEqual(['mcp', 'typecheck']);
    expect(missingFromTable(['lint', 'serve'], listed)).toEqual([]);
  });

  test('reads no table when the heading is missing', () => {
    expect(commandsTableNames(parseMarkdown('# Setup\n\n| a |\n| --- |\n| `b` |'))).toBeUndefined();
  });
});

describe('tracked markdown (real)', () => {
  const docs = readTrackedMarkdown();
  const scripts = packageScripts();
  const scan = scanCommands(docs, new Set(scripts));
  const setup = docs.find((doc) => doc.file === 'docs/setup.md');

  test('reads commands and scripts', () => {
    expect(scan.checked).toBeGreaterThan(0);
    expect(scripts.length).toBeGreaterThan(0);
  });

  test('every bun run command names a package.json script', () => {
    expect(scan.misses).toEqual([]);
  });

  test('every package.json script has a row in the commands table of docs/setup.md', () => {
    const listed = setup === undefined
      ? undefined
      : commandsTableNames(setup);
    expect(listed).toBeDefined();
    expect(missingFromTable(scripts, listed ?? [])).toEqual([]);
  });
});
