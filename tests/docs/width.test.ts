/**
 * The width check: every prose line of a tracked markdown file, headings included, is at most
 * 100 characters long. A line is counted in characters, one per Unicode code point, so an em dash
 * or an accented letter counts once however many bytes or UTF-16 units it takes. Fence lines,
 * table rows and YAML frontmatter are exempt, as the shared reader classifies them.
 *
 * @module
 */

import type { MarkdownDoc } from './markdown';

import { describe, expect, test } from 'bun:test';

import { parseMarkdown, readTrackedMarkdown } from './markdown';

/** The house width of one prose line, in characters. */
export const MAX_WIDTH = 100;

/** One markdown text to scan, keyed by its repo-relative posix path. */
interface ScanInput extends Pick<MarkdownDoc, 'prose'> {
  readonly file: string
}

/** What a scan read and what it found too wide. */
interface Scan {
  /** One `file:line width` entry per prose line over the width. */
  readonly misses: readonly string[]
  /** How many prose lines were checked, misses included. */
  readonly checked: number
}

/** The width of one line in characters: its Unicode code points. */
export function lineWidth(text: string): number {
  return [...text].length;
}

/** Pure scan: every prose line of `docs` is measured against `max`. */
export function scanWidth(docs: readonly ScanInput[], max: number = MAX_WIDTH): Scan {
  const misses: string[] = [];
  let checked = 0;
  for (const doc of docs) {
    for (const line of doc.prose) {
      checked += 1;
      const width = lineWidth(line.text);
      if (width > max) misses.push(`${doc.file}:${line.line} ${width}`);
    }
  }
  return { misses, checked };
}

describe('lineWidth', () => {
  test('counts code points, not bytes or UTF-16 units', () => {
    expect(lineWidth('a — é')).toBe(5);
    expect(lineWidth('\u{1D465}')).toBe(1);
    expect('\u{1D465}'.length).toBe(2);
  });
});

describe('scanWidth (failing control)', () => {
  const long = 'x'.repeat(150);
  const source = [
    '---',
    `title: ${long}`,
    '---',
    '',
    `# ${'h'.repeat(MAX_WIDTH - 1)}`,
    '',
    'w'.repeat(MAX_WIDTH),
    'w'.repeat(MAX_WIDTH + 1),
    `${'—'.repeat(MAX_WIDTH - 1)}\u{1D465}`,
    `  - ${'l'.repeat(MAX_WIDTH - 3)}`,
    '',
    `| ${long} |`,
    '',
    '```sh',
    long,
    '```',
  ].join('\n');
  const docs = [{ file: 'docs/a.md', ...parseMarkdown(source) }];

  test('reports exactly the planted over-wide prose lines', () => {
    const scan = scanWidth(docs);

    expect(scan.misses).toEqual(['docs/a.md:5 101', 'docs/a.md:8 101', 'docs/a.md:10 101']);
    expect(scan.checked).toBe(5);
  });

  test('passes the same lines once the width allows them', () => {
    expect(scanWidth(docs, MAX_WIDTH + 1).misses).toEqual([]);
  });
});

/**
 * Files the width check skips. `NOTES.md` is the assessment's hand-written log, kept exactly as
 * written, so it is not rewrapped to the house width.
 */
export const WIDTH_EXEMPT: ReadonlySet<string> = new Set(['NOTES.md']);

describe('tracked markdown (real)', () => {
  const scan = scanWidth(readTrackedMarkdown().filter((doc) => !WIDTH_EXEMPT.has(doc.file)));

  test('reads prose lines', () => {
    expect(scan.checked).toBeGreaterThan(0);
  });

  test(`every prose line is at most ${MAX_WIDTH} characters`, () => {
    expect(scan.misses).toEqual([]);
  });
});
