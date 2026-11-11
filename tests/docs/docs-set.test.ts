/**
 * The docs-set cross-check: every page of the set exists, every add-on page holds the six shared
 * sections as its level-2 headings in order, and `CLAUDE.md` names `bun run privacy` among the
 * gates.
 *
 * @module
 */

import type { MarkdownDoc, TrackedDoc } from './markdown';

import { describe, expect, test } from 'bun:test';

import { parseMarkdown, readTrackedMarkdown } from './markdown';

const DOCS_SET = [
  'README.md',
  'docs/setup.md',
  'docs/skills.md',
  'docs/database.md',
  'docs/auth.md',
  'docs/backup.md',
  'docs/mcp.md',
  'docs/open-notebook.md',
  'docs/web.md',
] as const;

const ADD_ON_PAGES = [
  'docs/database.md',
  'docs/auth.md',
  'docs/backup.md',
  'docs/mcp.md',
  'docs/open-notebook.md',
  'docs/web.md',
] as const;

const SHARED_SECTIONS = [
  'What it is and when to turn it on',
  'Setup from zero',
  'Configuration',
  'Check it works',
  'Turn it off',
  'Troubleshooting',
] as const;

const PRIVACY_GATE = 'bun run privacy';

/** The pages of `expected` that `files` does not hold. */
export function missingPages(files: readonly string[], expected: readonly string[]): readonly string[] {
  const present = new Set(files);
  return expected.filter((page) => !present.has(page));
}

/** The level-2 headings of `doc`, in order. */
export function sectionTitles(doc: Pick<MarkdownDoc, 'headings'>): readonly string[] {
  return doc.headings.filter((heading) => heading.level === 2).map((heading) => heading.text);
}

/** True when some backticked span of `doc` starts with the command `command`. */
export function namesCommand(doc: Pick<MarkdownDoc, 'spans'>, command: string): boolean {
  return doc.spans.some((span) => span.text === command || span.text.startsWith(`${command} `));
}

describe('docs set (failing control)', () => {
  test('reports exactly the page that is missing', () => {
    expect(missingPages(['README.md', 'docs/a.md'], ['README.md', 'docs/a.md', 'docs/b.md'])).toEqual(['docs/b.md']);
  });

  test('reads sections in order and rejects a swapped or short page', () => {
    const ok = parseMarkdown(SHARED_SECTIONS.map((title) => `## ${title}\n\ntext\n`).join('\n'));
    expect(sectionTitles(ok)).toEqual([...SHARED_SECTIONS]);
    const swapped = parseMarkdown('## Setup from zero\n\n## What it is and when to turn it on\n');
    expect(sectionTitles(swapped)).not.toEqual([...SHARED_SECTIONS]);
    const short = parseMarkdown('# T\n\n## Configuration\n\n### Sub\n');
    expect(sectionTitles(short)).toEqual(['Configuration']);
  });

  test('finds the gate in a span and not in a fence or other text', () => {
    expect(namesCommand(parseMarkdown('Gates: `bun run privacy`, in order.'), PRIVACY_GATE)).toBe(true);
    expect(namesCommand(parseMarkdown('Gates: `bun run privacy -- --no-gitleaks`.'), PRIVACY_GATE)).toBe(true);
    expect(namesCommand(parseMarkdown('Gates: `bun run lint`.\n\n```sh\nbun run privacy\n```\n'), PRIVACY_GATE)).toBe(false);
    expect(namesCommand(parseMarkdown('Gates: `bun run privacy-x`.'), PRIVACY_GATE)).toBe(false);
  });
});

describe('docs set (real)', () => {
  const docs = readTrackedMarkdown();
  const byFile = (file: string): TrackedDoc | undefined => docs.find((doc) => doc.file === file);

  test('every page of the set exists', () => {
    expect(missingPages(docs.map((doc) => doc.file), DOCS_SET)).toEqual([]);
  });

  for (const page of ADD_ON_PAGES) {
    test(`${page} holds the six shared sections in order`, () => {
      const doc = byFile(page);
      expect(doc).toBeDefined();
      expect(sectionTitles(doc ?? { headings: [] })).toEqual([...SHARED_SECTIONS]);
    });
  }

  test('CLAUDE.md names bun run privacy among the gates', () => {
    const claude = byFile('CLAUDE.md');
    expect(claude).toBeDefined();
    expect(namesCommand(claude ?? { spans: [] }, PRIVACY_GATE)).toBe(true);
  });
});
