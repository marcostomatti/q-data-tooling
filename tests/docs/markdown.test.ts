import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  isPlanningDoc,
  listTrackedMarkdown,
  parseMarkdown,
  readTrackedMarkdown,
  resolveLink,
  splitCells,
} from './markdown';

const FENCE = '```';

const SAMPLE = [
  '---',
  'name: sample',
  '---',
  '# Title',
  '',
  'Run `bun run lint` and read [the setup](setup.md#commands), then',
  'the `src/x.ts` file.',
  '',
  `${FENCE}ts`,
  '// src/x.ts',
  'const a = `not a span`;',
  '[not](a-link.md)',
  FENCE,
  '',
  '| Name | Use |',
  '| --- | :---: |',
  '| `PORT` | the a \\| b port |',
  '',
  '## Closing hashes ##',
].join('\n');

describe('parseMarkdown', () => {
  const doc = parseMarkdown(SAMPLE);

  test('classifies each line', () => {
    expect(doc.lines.map((l) => l.kind)).toEqual([
      'frontmatter', 'frontmatter', 'frontmatter',
      'prose', 'blank', 'prose', 'prose', 'blank',
      'fence', 'fence', 'fence', 'fence', 'fence', 'blank',
      'table', 'table', 'table', 'blank', 'prose',
    ]);
    expect(doc.prose.map((l) => l.line)).toEqual([4, 6, 7, 19]);
  });

  test('yields each fence with its info and first line', () => {
    expect(doc.fences).toEqual([
      {
        line: 9,
        info: 'ts',
        body: ['// src/x.ts', 'const a = `not a span`;', '[not](a-link.md)'],
        firstLine: '// src/x.ts',
      },
    ]);
  });

  test('yields table rows with cells, the delimiter row marked', () => {
    expect(doc.tableRows.map((r) => [r.line, r.cells, r.delimiter])).toEqual([
      [15, ['Name', 'Use'], false],
      [16, ['---', ':---:'], true],
      [17, ['`PORT`', 'the a | b port'], false],
    ]);
  });

  test('yields spans from prose and tables, none from fences or frontmatter', () => {
    expect(doc.spans).toEqual([
      { line: 6, text: 'bun run lint' },
      { line: 7, text: 'src/x.ts' },
      { line: 17, text: 'PORT' },
    ]);
  });

  test('yields relative links outside fences', () => {
    expect(doc.links).toEqual([
      {
        line: 6,
        text: 'the setup',
        target: 'setup.md#commands',
        path: 'setup.md',
        anchor: 'commands',
        image: false,
      },
    ]);
  });

  test('yields ATX headings without their closing hashes', () => {
    expect(doc.headings).toEqual([
      { line: 4, level: 1, text: 'Title' },
      { line: 19, level: 2, text: 'Closing hashes' },
    ]);
  });

  test('an empty text yields nothing', () => {
    const empty = parseMarkdown('');
    expect([empty.lines, empty.fences, empty.spans, empty.links, empty.headings]).toEqual([[], [], [], [], []]);
  });
});

describe('spans', () => {
  test('a span wrapped across lines opens on its first line, the break read as a space', () => {
    const doc = parseMarkdown('says `OIDC_ISSUER must be\nabsolute.` and `x`.');
    expect(doc.spans).toEqual([
      { line: 1, text: 'OIDC_ISSUER must be absolute.' },
      { line: 2, text: 'x' },
    ]);
  });

  test('a span never crosses a blank line or a heading', () => {
    expect(parseMarkdown('an `open\n\nclose` b').spans).toEqual([]);
    expect(parseMarkdown('an `open\n# h\nclose` b').spans).toEqual([]);
  });

  test('a double-backtick span holds a single backtick, and a padded span loses its padding', () => {
    expect(parseMarkdown('``a ` b`` and `` `c` ``').spans.map((s) => s.text)).toEqual(['a ` b', '`c`']);
  });

  test('an escaped backtick opens no span', () => {
    expect(parseMarkdown('a \\`b` c').spans).toEqual([]);
  });
});

describe('links', () => {
  test('skips absolute links and keeps same-file anchors and images', () => {
    const doc = parseMarkdown('[a](https://x.dev) [b](//cdn.x) [c](mailto:me) [d](#top) ![e](img/p%20q.png "t")');
    expect(doc.links.map((l) => [l.text, l.path, l.anchor, l.image])).toEqual([
      ['d', '', 'top', false],
      ['e', 'img/p q.png', undefined, true],
    ]);
  });

  test('reads a link whose text holds a span or wraps, on the line of its target', () => {
    const doc = parseMarkdown('see [`docs/setup.md`\nfor more\n](setup.md) and [<x>](<a b.md>)');
    expect(doc.links.map((l) => [l.line, l.text, l.target])).toEqual([
      [3, '`docs/setup.md`\nfor more\n', 'setup.md'],
      [3, '<x>', 'a b.md'],
    ]);
  });

  test('reads no link inside a span or across a blank line', () => {
    expect(parseMarkdown('`[a](b.md)`').links).toEqual([]);
    expect(parseMarkdown('[a\n\n](b.md)').links).toEqual([]);
  });

  test('reads no link from an escaped bracket', () => {
    expect(parseMarkdown('\\[a](b.md) and [c\\](d.md)').links).toEqual([]);
    expect(parseMarkdown('[a \\[b\\]](c.md)').links.map((l) => l.target)).toEqual(['c.md']);
  });

  test('resolves a link from the folder of its file', () => {
    expect(resolveLink('docs/web.md', { path: '../src/web/README.md' })).toBe('src/web/README.md');
    expect(resolveLink('docs/web.md', { path: 'auth.md' })).toBe('docs/auth.md');
    expect(resolveLink('docs/web.md', { path: '' })).toBe('docs/web.md');
    expect(resolveLink('README.md', { path: '/docs/a.md' })).toBe('docs/a.md');
    expect(resolveLink('README.md', { path: '../x.md' })).toBe('../x.md');
  });
});

describe('fences', () => {
  test('an indented fence strips its indentation from the body', () => {
    const doc = parseMarkdown(['1. step', '', `   ${FENCE}sh`, '   bun test', '     nested', `   ${FENCE}`].join('\n'));
    expect(doc.fences).toEqual([{ line: 3, info: 'sh', body: ['bun test', '  nested'], firstLine: 'bun test' }]);
  });

  test('a shorter or other marker does not close a fence, and an unclosed one runs to the end', () => {
    const doc = parseMarkdown(['````md', FENCE, '~~~', '````', '~~~', 'body'].join('\n'));
    expect(doc.fences.map((f) => [f.line, f.body])).toEqual([
      [1, [FENCE, '~~~']],
      [5, ['body']],
    ]);
    expect(doc.prose).toEqual([]);
  });

  test('a backtick line with a backtick in its info is prose, not a fence', () => {
    expect(parseMarkdown('``` a ` b').fences).toEqual([]);
  });

  test('an empty fence has no first line', () => {
    expect(parseMarkdown([FENCE, FENCE].join('\n')).fences[0]?.firstLine).toBeUndefined();
  });
});

describe('frontmatter and tables', () => {
  test('a `---` past line 1, or an unclosed one, is not frontmatter', () => {
    expect(parseMarkdown('a\n---\nb: c\n---').lines.some((l) => l.kind === 'frontmatter')).toBe(false);
    expect(parseMarkdown('---\nb: c').lines.some((l) => l.kind === 'frontmatter')).toBe(false);
    expect(parseMarkdown('---\nb: c\n...\nx').lines.map((l) => l.kind)).toEqual([
      'frontmatter', 'frontmatter', 'frontmatter', 'prose',
    ]);
  });

  test('splits cells with and without edge pipes', () => {
    expect(splitCells('| a | b |')).toEqual(['a', 'b']);
    expect(splitCells('| a | |')).toEqual(['a', '']);
    expect(splitCells('a | b')).toEqual(['a', 'b']);
  });
});

describe('tracked markdown', () => {
  test('lists the checkout markdown files, and its own docs among them', () => {
    const files = listTrackedMarkdown();
    expect(files).toContain('README.md');
    expect(files).toContain('docs/setup.md');
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
  });

  test('lists an untracked file git does not ignore, and skips an ignored one', () => {
    const root = mkdtempSync(join(tmpdir(), 'markdown-'));
    try {
      expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
      writeFileSync(join(root, '.gitignore'), 'ignored.md\n');
      writeFileSync(join(root, 'kept.md'), '# Kept\n');
      writeFileSync(join(root, 'ignored.md'), '# Ignored\n');
      writeFileSync(join(root, 'notes.txt'), 'x\n');
      const docs = readTrackedMarkdown(root);
      expect(docs.map((d) => [d.file, d.headings.map((h) => h.text)])).toEqual([['kept.md', ['Kept']]]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('throws outside a work tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'markdown-'));
    try {
      expect(() => listTrackedMarkdown(root)).toThrow('git ls-files failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('every real doc parses with at least one heading or prose line', () => {
    const docs = readTrackedMarkdown();
    expect(docs.length).toBeGreaterThan(0);
    const empty = docs.filter((d) => d.prose.length === 0).map((d) => d.file);
    expect(empty).toEqual([]);
    const fenced = docs.reduce((sum, d) => sum + d.fences.length, 0);
    const linked = docs.reduce((sum, d) => sum + d.links.length, 0);
    expect(fenced).toBeGreaterThan(0);
    expect(linked).toBeGreaterThan(0);
  });
});

describe('isPlanningDoc', () => {
  test('matches the setup prompts and the spec and plan folders', () => {
    const planning = ['setup-prompt.md', 'setup-prompt-review.md', 'schema-survey-review.md',
      'docs/specs/sec-filings.md', 'docs/plans/PLAN-sec-filings.md',
      'docs/plans/PLAN_TRACKER-sec-filings.md'];
    expect(planning.filter((file) => !isPlanningDoc(file))).toEqual([]);
  });

  test('leaves every other page to the paths and quoted-code checks', () => {
    const pages = ['README.md', 'CLAUDE.md', 'NOTES.md', 'docs/setup.md', 'docs/specs.md',
      'src/web/README.md', 'docs/specs/notes.txt'];
    expect(pages.filter((file) => isPlanningDoc(file))).toEqual([]);
  });
});
