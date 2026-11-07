/**
 * The links and anchors check: every relative link to a markdown file that carries a `#anchor`
 * names a heading of that file, by the slug GitHub gives the heading. A link to an anchor in the
 * same file is read against the file's own headings. A target holding a placeholder, such as
 * `<name>`, is skipped by that rule alone; the paths check asserts that the target file exists.
 *
 * GitHub's slug rule, as `github-slugger` writes it: the heading's rendered text, lowercased, with
 * every character that is not a letter, a mark, a number, a connector such as `_`, a hyphen or a
 * space removed, and each space turned into a hyphen, so an em dash between spaces leaves two
 * spaces and slugs to a double hyphen. A heading whose slug an earlier heading of the file already
 * holds gets `-1`, `-2` and on.
 *
 * @module
 */

import type { Heading, Link } from './markdown';

import { describe, expect, test } from 'bun:test';

import { parseMarkdown, readTrackedMarkdown, resolveLink } from './markdown';

/** One markdown text to scan, keyed by its repo-relative posix path. */
interface ScanInput {
  readonly file: string
  readonly links: readonly Link[]
  readonly headings: readonly Heading[]
}

/** What a scan read and what it found missing. */
interface Scan {
  /** One `file:line target` entry per anchor no heading of the target slugs to. */
  readonly misses: readonly string[]
  /** How many anchors were checked, misses included. */
  readonly checked: number
}

const PLACEHOLDER = /<[^>]*>/;
const NOT_IN_SLUG = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;
const INLINE_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;

/** A heading's text as GitHub renders it: links read as their text, backticks dropped. */
function renderedText(heading: string): string {
  return heading.replace(INLINE_LINK, '$1').replace(/`/g, '');
}

/** The slug GitHub gives one heading's text, before the duplicate suffix. */
export function slug(heading: string): string {
  return renderedText(heading).toLowerCase()
    .replace(NOT_IN_SLUG, '')
    .replace(/ /g, '-');
}

/** The anchors of one file's headings in order, with GitHub's `-1`, `-2` suffix on a repeat. */
export function headingAnchors(headings: readonly Pick<Heading, 'text'>[]): ReadonlySet<string> {
  const anchors = new Set<string>();
  for (const heading of headings) {
    const base = slug(heading.text);
    let anchor = base;
    for (let n = 1; anchors.has(anchor); n += 1) anchor = `${base}-${n}`;
    anchors.add(anchor);
  }
  return anchors;
}

function decodeAnchor(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

/**
 * Pure scan: every anchor of a link to a markdown file in `docs` is read against the headings of
 * its target, looked up by `headingsOf`; a target `headingsOf` does not hold is left to the paths
 * check.
 */
export function scanAnchors(
  docs: readonly ScanInput[],
  headingsOf: (file: string) => readonly Pick<Heading, 'text'>[] | undefined,
): Scan {
  const misses: string[] = [];
  let checked = 0;
  for (const doc of docs) {
    for (const link of doc.links) {
      if (link.anchor === undefined || link.anchor === '' || PLACEHOLDER.test(link.target)) continue;
      const target = resolveLink(doc.file, link);
      if (!target.endsWith('.md')) continue;
      const headings = headingsOf(target);
      if (headings === undefined) continue;
      checked += 1;
      if (!headingAnchors(headings).has(decodeAnchor(link.anchor))) misses.push(`${doc.file}:${link.line} ${link.target}`);
    }
  }
  return { misses, checked };
}

/** The headings of each scanned markdown file, by path; `undefined` for a file not scanned. */
function trackedHeadings(docs: readonly ScanInput[]): (file: string) => readonly Heading[] | undefined {
  const byFile = new Map(docs.map((doc) => [doc.file, doc.headings]));
  return (file) => byFile.get(file);
}

describe('slug (GitHub rule)', () => {
  const docs = readTrackedMarkdown();
  const realHeadings = new Set(docs.flatMap((doc) => doc.headings.map((h) => h.text)));

  /** Real headings of the docs, each with the anchor GitHub gives it. */
  const REAL: readonly (readonly [string, string])[] = [
    ['The ESLint `--fix` hook', 'the-eslint---fix-hook'],
    ['Create `.env`', 'create-env'],
    ['What it is and when to turn it on', 'what-it-is-and-when-to-turn-it-on'],
    ['1. Back up', '1-back-up'],
    ['Publishing with `scripts/public-export.ts`', 'publishing-with-scriptspublic-exportts'],
    ['Backfill: a custom migration', 'backfill-a-custom-migration'],
  ];

  test('the sample headings are real headings of the tracked docs', () => {
    expect(REAL.map(([heading]) => heading).filter((h) => !realHeadings.has(h))).toEqual([]);
  });

  test('slugs each real heading to its anchor', () => {
    expect(REAL.map(([heading]) => slug(heading))).toEqual(REAL.map(([, anchor]) => anchor));
  });

  test('each anchor resolves back to its heading among the file headings', () => {
    for (const [heading, anchor] of REAL) {
      const doc = docs.find((d) => d.headings.some((h) => h.text === heading));
      expect(doc && headingAnchors(doc.headings).has(anchor)).toBe(true);
    }
  });

  test('an em dash between spaces slugs to a double hyphen', () => {
    expect(slug('Setup — from zero')).toBe('setup--from-zero');
    expect(headingAnchors([{ text: 'Setup — from zero' }]).has('setup-from-zero')).toBe(false);
  });

  test('a repeated heading takes a numbered suffix', () => {
    const anchors = headingAnchors([{ text: 'Verify' }, { text: 'Verify' }, { text: 'Verify' }]);
    expect([...anchors]).toEqual(['verify', 'verify-1', 'verify-2']);
  });

  test('a link in a heading slugs by its text', () => {
    expect(slug('See [the gates](setup.md#the-gates)')).toBe('see-the-gates');
  });
});

describe('scanAnchors (failing control)', () => {
  const target = parseMarkdown(['# Setup', '', '## The first run', '', '## Setup — from zero'].join('\n'));
  const source = [
    '# Here',
    '',
    'Read [run](setup.md#the-first-run), [dash](setup.md#setup--from-zero), [here](#here),',
    'not [gone](setup.md#the-last-run), [self](#elsewhere) or [one](setup.md#setup-from-zero);',
    'skip [code](../src/x.ts#L3), [missing](absent.md#x) and [slot](src/<name>/x.md#x).',
  ].join('\n');
  const docs = [{ file: 'docs/a.md', ...parseMarkdown(source) }, { file: 'docs/setup.md', ...target }];
  const headingsOf = trackedHeadings(docs);

  test('reports exactly the planted missing anchors', () => {
    const scan = scanAnchors(docs, headingsOf);

    expect(scan.misses).toEqual([
      'docs/a.md:4 setup.md#the-last-run',
      'docs/a.md:4 #elsewhere',
      'docs/a.md:4 setup.md#setup-from-zero',
    ]);
    expect(scan.checked).toBe(6);
  });

  test('passes the same links once every anchor is a heading', () => {
    const all = (file: string): readonly Pick<Heading, 'text'>[] | undefined => file === 'docs/absent.md'
      ? undefined
      : [
        'the first run',
        'setup — from zero',
        'here',
        'the last run',
        'elsewhere',
        'setup from zero',
      ].map((text) => ({ text }));
    expect(scanAnchors(docs, all).misses).toEqual([]);
  });
});

describe('tracked markdown (real)', () => {
  const docs = readTrackedMarkdown();
  const scan = scanAnchors(docs, trackedHeadings(docs));

  test('reads anchored links', () => {
    expect(scan.checked).toBeGreaterThan(0);
  });

  test('every relative link anchor names a heading of its target', () => {
    expect(scan.misses).toEqual([]);
  });
});
