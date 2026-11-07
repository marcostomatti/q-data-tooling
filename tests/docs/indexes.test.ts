/**
 * The indexes check: `README.md` links every page `docs/*.md`, and the two skill indexes, the whole
 * of `docs/skills.md` and the `Commands` section of `CLAUDE.md`, each list every action file under
 * `.claude/skills/<group>/actions/` and list no action that has no file.
 *
 * A page counts as linked when a relative link of `README.md` resolves to it, anchor or not. An
 * action counts as listed when a backticked span opens with its call, `/<group> <action>`, such as
 * `/db add <table>` or `/db migrate`; a call names the file `.claude/skills/<group>/actions/
 * <action>.md`. A span naming a group alone, such as `/fe`, or a URL path, such as `/api/info`,
 * names no action. The `Commands` section runs from its heading to the next heading of the same
 * level or above.
 *
 * @module
 */

import type { Heading, MarkdownDoc, TrackedDoc } from './markdown';

import { describe, expect, test } from 'bun:test';

import { listTrackedMarkdown, parseMarkdown, readTrackedMarkdown, resolveLink } from './markdown';

const DOCS_PAGE = /^docs\/[^/]+\.md$/;
const ACTION_FILE = /^\.claude\/skills\/([^/]+)\/actions\/([^/]+)\.md$/;
const ACTION_CALL = /^\/([a-z][\w-]*) ([a-z][\w-]*)(?:\s|$)/;

/** The `docs/*.md` pages among `files`, in their order. */
export function docsPages(files: readonly string[]): readonly string[] {
  return files.filter((file) => DOCS_PAGE.test(file));
}

/** The action files among `files`, each as its call, such as `/db add`. */
export function actionFiles(files: readonly string[]): readonly string[] {
  return files.flatMap((file) => {
    const match = ACTION_FILE.exec(file);
    return match === null
      ? []
      : [`/${match[1] ?? ''} ${match[2] ?? ''}`];
  });
}

/** The pages of `pages` that no relative link of `readme` resolves to. */
export function unlinkedPages(readme: Pick<MarkdownDoc, 'links'>, pages: readonly string[]): readonly string[] {
  const linked = new Set(readme.links.map((link) => resolveLink('README.md', link)));
  return pages.filter((page) => !linked.has(page));
}

/** The calls the spans of `doc` list, once each, in first-seen order; within `lines` when given. */
export function listedActions(
  doc: Pick<MarkdownDoc, 'spans'>,
  lines?: { readonly from: number, readonly to: number },
): readonly string[] {
  const calls = doc.spans.flatMap((span) => {
    if (lines !== undefined && (span.line < lines.from || span.line >= lines.to)) return [];
    const match = ACTION_CALL.exec(span.text);
    return match === null
      ? []
      : [`/${match[1] ?? ''} ${match[2] ?? ''}`];
  });
  return [...new Set(calls)];
}

/**
 * The line range of the section under the first heading named `title`: from the heading to the
 * next heading of its level or above, or the end; `undefined` when no heading is named `title`.
 */
export function sectionLines(
  doc: Pick<MarkdownDoc, 'headings'>,
  title: string,
): { readonly from: number, readonly to: number } | undefined {
  const index = doc.headings.findIndex((h) => h.text === title);
  const heading: Heading | undefined = doc.headings[index];
  if (heading === undefined) return undefined;
  const next = doc.headings.slice(index + 1).find((h) => h.level <= heading.level);
  return { from: heading.line, to: next?.line ?? Number.POSITIVE_INFINITY };
}

/** What an index leaves out and what it lists without a file. */
export function compareActions(
  files: readonly string[],
  listed: readonly string[],
): { readonly missing: readonly string[], readonly unknown: readonly string[] } {
  const listedSet = new Set(listed);
  const fileSet = new Set(files);
  return {
    missing: files.filter((call) => !listedSet.has(call)),
    unknown: listed.filter((call) => !fileSet.has(call)),
  };
}

describe('docs pages linked from README (failing control)', () => {
  const files = ['README.md', 'docs/a.md', 'docs/b.md', 'docs/nested/c.md', 'CLAUDE.md'];
  const readme = parseMarkdown([
    '# Readme',
    '',
    '- [A](docs/a.md#intro): the first page.',
    '- [Elsewhere](CLAUDE.md), and `[B](docs/b.md)` inside a span.',
  ].join('\n'));

  test('reads only the pages directly under docs/', () => {
    expect(docsPages(files)).toEqual(['docs/a.md', 'docs/b.md']);
  });

  test('reports exactly the page no link reaches', () => {
    expect(unlinkedPages(readme, docsPages(files))).toEqual(['docs/b.md']);
  });

  test('passes once the page is linked', () => {
    const linked = parseMarkdown('# Readme\n\n[A](docs/a.md) and [B](./docs/b.md).');
    expect(unlinkedPages(linked, docsPages(files))).toEqual([]);
  });
});

describe('actions listed in an index (failing control)', () => {
  const files = [
    '.claude/skills/be/actions/create-route.md',
    '.claude/skills/db/actions/add.md',
    '.claude/skills/db/actions/migrate.md',
    '.claude/skills/db/SKILL.md',
    '.claude/skills/db/reference/data-changes.md',
  ];
  const doc = parseMarkdown([
    '# Notes',
    '',
    '- `/be create-route <entity>`: a route. Of the `/fe` actions none is built.',
    '- `/db add notes` and `GET /api/info`, then `/db gone`.',
    '',
    '## Commands',
    '',
    '- `/db migrate`: applies them.',
    '',
    '### Detail',
    '',
    '- `/db add <table>`: a table.',
    '',
    '## After',
    '',
    '- `/be create-route note`.',
  ].join('\n'));

  test('reads each action file as its call', () => {
    expect(actionFiles(files)).toEqual(['/be create-route', '/db add', '/db migrate']);
  });

  test('reads each call once, and no group alone or URL path', () => {
    expect(listedActions(doc)).toEqual(['/be create-route', '/db add', '/db gone', '/db migrate']);
  });

  test('bounds a section by the next heading of its level, not a deeper one', () => {
    const section = sectionLines(doc, 'Commands');
    expect(section).toEqual({ from: 6, to: 14 });
    expect(listedActions(doc, section)).toEqual(['/db migrate', '/db add']);
    expect(sectionLines(doc, 'Missing')).toBeUndefined();
  });

  test('reports exactly the file left out and the call with no file', () => {
    const calls = actionFiles(files);
    expect(compareActions(calls, listedActions(doc, sectionLines(doc, 'Commands')))).toEqual({
      missing: ['/be create-route'],
      unknown: [],
    });
    expect(compareActions(calls, listedActions(doc))).toEqual({ missing: [], unknown: ['/db gone'] });
  });
});

describe('tracked markdown (real)', () => {
  const files = listTrackedMarkdown();
  const docs = readTrackedMarkdown();
  const byFile = (file: string): TrackedDoc | undefined => docs.find((doc) => doc.file === file);
  const pages = docsPages(files);
  const calls = actionFiles(files);

  test('reads pages and action files', () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
  });

  test('README.md links every docs/*.md page', () => {
    const readme = byFile('README.md');
    expect(readme).toBeDefined();
    expect(unlinkedPages(readme ?? { links: [] }, pages)).toEqual([]);
  });

  test('docs/skills.md lists every action file and no action without one', () => {
    const skills = byFile('docs/skills.md');
    expect(skills).toBeDefined();
    expect(compareActions(calls, listedActions(skills ?? { spans: [] }))).toEqual({ missing: [], unknown: [] });
  });

  test('the Commands section of CLAUDE.md lists every action file and no action without one', () => {
    const claude = byFile('CLAUDE.md');
    const section = claude === undefined
      ? undefined
      : sectionLines(claude, 'Commands');
    expect(section).toBeDefined();
    const listed = claude === undefined || section === undefined
      ? []
      : listedActions(claude, section);
    expect(compareActions(calls, listed)).toEqual({ missing: [], unknown: [] });
  });
});
