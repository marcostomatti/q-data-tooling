/**
 * The shared markdown reader for the docs checks under `tests/docs/`: it lists the markdown files
 * git would track and splits one file's text into the parts a check reads.
 *
 * A file is classified line by line. A YAML frontmatter block opens on line 1 with `---` and
 * closes at the next `---` or `...` line. A fence opens with three or more backticks or tildes at
 * any indentation and closes at a line of the same character, at least as long, and nothing else;
 * an unclosed fence runs to the end of the file. Outside those, a line whose text starts with `|`
 * is a table row, a blank line is blank, and every other line is prose, headings included.
 *
 * Backticked spans and links are read over blocks, not lines, because hand-wrapped prose wraps
 * inside both: a block is a run of prose lines between blank lines, a heading, or one table row. A
 * span opens at a run of backticks and closes at the next run of the same length in its block,
 * with a line break inside it read as a space, as CommonMark reads it. Neither reaches into a fence
 * or the frontmatter.
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/** The checkout root, two folders above this file. */
export const REPO_ROOT = join(import.meta.dir, '..', '..');

/** What one line of a markdown file is. */
export type LineKind = 'frontmatter' | 'fence' | 'table' | 'prose' | 'blank';

/** One classified line; `line` counts from 1. */
export interface MarkdownLine {
  readonly line: number
  readonly text: string
  readonly kind: LineKind
}

/** A fenced block: its opening line, info string, and the lines between its fences. */
export interface Fence {
  /** The line of the opening fence. */
  readonly line: number
  /** The text after the opening fence, trimmed, such as `ts` or `sh`. */
  readonly info: string
  /** The body, with up to the opening fence's indentation taken off each line. */
  readonly body: readonly string[]
  /** The body's first line, or `undefined` for an empty block. */
  readonly firstLine: string | undefined
}

/** One table row, its cells split on each unescaped `|` and trimmed. */
export interface TableRow {
  readonly line: number
  readonly text: string
  readonly cells: readonly string[]
  /** True for the `|---|:---:|` row under the header. */
  readonly delimiter: boolean
}

/** One backticked span: its text without the backticks, on the line it opens on. */
export interface Span {
  readonly line: number
  readonly text: string
}

/** A relative link or image, on the line its target is on. */
export interface Link {
  readonly line: number
  readonly text: string
  /** The target as written, without angle brackets or a title. */
  readonly target: string
  /** The target's path, percent-decoded; empty for a link to an anchor in the same file. */
  readonly path: string
  /** The anchor after `#`, without it, or `undefined` when the target has none. */
  readonly anchor: string | undefined
  readonly image: boolean
}

/** An ATX heading, `#` to `######`, with any closing `#`s taken off. */
export interface Heading {
  readonly line: number
  readonly level: number
  readonly text: string
}

/** One markdown text split into the parts the docs checks read. */
export interface MarkdownDoc {
  readonly lines: readonly MarkdownLine[]
  /** Every prose line, headings included; blank lines are not prose. */
  readonly prose: readonly MarkdownLine[]
  readonly fences: readonly Fence[]
  readonly tableRows: readonly TableRow[]
  readonly spans: readonly Span[]
  readonly links: readonly Link[]
  readonly headings: readonly Heading[]
}

/** One tracked markdown file, read and parsed. */
export interface TrackedDoc extends MarkdownDoc {
  /** Repo-relative posix path, such as `docs/setup.md`. */
  readonly file: string
}

const FENCE_OPEN = /^( *)(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const DELIMITER_CELL = /^:?-+:?$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LINK_TAIL = /^\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/;

/** An open fence: its marker character, length and indentation. */
interface OpenFence {
  readonly char: string
  readonly length: number
  readonly indent: number
  readonly line: number
  readonly info: string
  readonly body: string[]
}

function closesFence(text: string, open: OpenFence): boolean {
  const trimmed = text.trim();
  return trimmed.length >= open.length && [...trimmed].every((c) => c === open.char);
}

function stripIndent(text: string, indent: number): string {
  const leading = text.length - text.trimStart().length;
  return text.slice(Math.min(leading, indent));
}

function frontmatterEnd(rows: readonly string[]): number {
  if (rows[0] !== '---') return 0;
  const close = rows.findIndex((row, i) => i > 0 && (row === '---' || row === '...'));
  return close === -1
    ? 0
    : close + 1;
}

function classify(rows: readonly string[]): { lines: MarkdownLine[], fences: Fence[] } {
  const lines: MarkdownLine[] = [];
  const fences: Fence[] = [];
  const front = frontmatterEnd(rows);
  let open: OpenFence | undefined;
  const closeFence = (fence: OpenFence): void => {
    fences.push({ line: fence.line, info: fence.info, body: fence.body, firstLine: fence.body[0] });
  };
  rows.forEach((text, i) => {
    const line = i + 1;
    if (i < front) {
      lines.push({ line, text, kind: 'frontmatter' });
      return;
    }
    if (open !== undefined) {
      lines.push({ line, text, kind: 'fence' });
      if (closesFence(text, open)) {
        closeFence(open);
        open = undefined;
      } else open.body.push(stripIndent(text, open.indent));
      return;
    }
    const fence = FENCE_OPEN.exec(text);
    const marker = fence?.[2] ?? '';
    const info = fence?.[3] ?? '';
    if (fence !== null && !(marker.startsWith('`') && info.includes('`'))) {
      const indent = fence[1]?.length ?? 0;
      open = { char: marker.charAt(0), length: marker.length, indent, line, info: info.trim(), body: [] };
      lines.push({ line, text, kind: 'fence' });
      return;
    }
    const kind: LineKind = text.trim() === ''
      ? 'blank'
      : text.trimStart().startsWith('|')
        ? 'table'
        : 'prose';
    lines.push({ line, text, kind });
  });
  if (open !== undefined) closeFence(open);
  return { lines, fences };
}

/** The cells of one table row, split on each `|` no backslash escapes. */
export function splitCells(text: string): readonly string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === '\\' && text.charAt(i + 1) === '|') {
      cell += '|';
      i += 1;
    } else if (c === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  cells.push(cell.trim());
  const trimmed = text.trim();
  const start = trimmed.startsWith('|')
    ? 1
    : 0;
  const end = trimmed.endsWith('|') && trimmed.length > 1
    ? cells.length - 1
    : cells.length;
  return cells.slice(start, end);
}

function toTableRow(row: MarkdownLine): TableRow {
  const cells = splitCells(row.text);
  const delimiter = cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
  return { line: row.line, text: row.text, cells, delimiter };
}

function toHeading(row: MarkdownLine): Heading | undefined {
  const match = HEADING.exec(row.text);
  if (match === null) return undefined;
  return { line: row.line, level: match[1]?.length ?? 0, text: (match[2] ?? '').trim() };
}

/** Consecutive lines read as one text, so a span or link may wrap. */
interface Block {
  readonly first: number
  readonly text: string
}

function toBlocks(lines: readonly MarkdownLine[]): readonly Block[] {
  const blocks: Block[] = [];
  let run: MarkdownLine[] = [];
  const flush = (): void => {
    const head = run[0];
    if (head !== undefined) blocks.push({ first: head.line, text: run.map((l) => l.text).join('\n') });
    run = [];
  };
  for (const row of lines) {
    const alone = row.kind === 'table' || (row.kind === 'prose' && HEADING.test(row.text));
    if (row.kind !== 'prose' || alone) flush();
    if (alone) {
      run = [row];
      flush();
    } else if (row.kind === 'prose') run.push(row);
  }
  flush();
  return blocks;
}

function lineAt(block: Block, offset: number): number {
  let line = block.first;
  for (let i = 0; i < offset; i += 1) if (block.text.charAt(i) === '\n') line += 1;
  return line;
}

function backtickRun(text: string, at: number): number {
  let end = at;
  while (text.charAt(end) === '`') end += 1;
  return end - at;
}

/** Finds the close of the span whose opening run of `size` backticks ends at `from`. */
function spanClose(text: string, from: number, size: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text.charAt(i) !== '`') continue;
    const run = backtickRun(text, i);
    if (run === size) return i;
    i += run - 1;
  }
  return -1;
}

function spanText(raw: string): string {
  const text = raw.replace(/\n/g, ' ');
  return text.startsWith(' ') && text.endsWith(' ') && text.trim() !== ''
    ? text.slice(1, -1)
    : text;
}

/**
 * The spans of one block, and its text with every span's content blanked to spaces, so a link
 * search over it never reads inside a span.
 */
function scanSpans(block: Block): { spans: Span[], masked: string } {
  const { text } = block;
  const spans: Span[] = [];
  let masked = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === '\\' && i + 1 < text.length) {
      masked += c + text.charAt(i + 1);
      i += 1;
      continue;
    }
    if (c !== '`') {
      masked += c;
      continue;
    }
    const size = backtickRun(text, i);
    const close = spanClose(text, i + size, size);
    if (close === -1) {
      masked += text.slice(i, i + size);
      i += size - 1;
      continue;
    }
    spans.push({ line: lineAt(block, i), text: spanText(text.slice(i + size, close)) });
    masked += text.slice(i, i + size) + text.slice(i + size, close).replace(/[^\n]/g, ' ') + text.slice(close, close + size);
    i = close + size - 1;
  }
  return { spans, masked };
}

/** A link target split into its path and anchor, or `undefined` when it is not relative. */
function relativeTarget(target: string): { path: string, anchor: string | undefined } | undefined {
  if (target === '' || SCHEME.test(target) || target.startsWith('//')) return undefined;
  const hash = target.indexOf('#');
  const rawPath = hash === -1
    ? target
    : target.slice(0, hash);
  const anchor = hash === -1
    ? undefined
    : target.slice(hash + 1);
  try {
    return { path: decodeURIComponent(rawPath), anchor };
  } catch {
    return { path: rawPath, anchor };
  }
}

/** The index of the `[` that opens the link text whose `]` is at `close`, or -1. */
function linkOpen(masked: string, close: number): number {
  let depth = 0;
  for (let i = close - 1; i >= 0; i -= 1) {
    const c = masked.charAt(i);
    if (masked.charAt(i - 1) === '\\') continue;
    if (c === '\n' && masked.charAt(i - 1) === '\n') return -1;
    if (c === ']') depth += 1;
    else if (c === '[') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function scanLinks(block: Block, masked: string): Link[] {
  const links: Link[] = [];
  for (let close = masked.indexOf(']('); close !== -1; close = masked.indexOf('](', close + 1)) {
    if (masked.charAt(close - 1) === '\\') continue;
    const open = linkOpen(masked, close);
    const tail = LINK_TAIL.exec(masked.slice(close + 1));
    if (open === -1 || tail === null) continue;
    const written = tail[1] ?? '';
    const start = close + 1 + tail[0].indexOf(written);
    const target = block.text.slice(start, start + written.length).replace(/^<|>$/g, '');
    const parts = relativeTarget(target);
    if (parts === undefined) continue;
    const image = masked.charAt(open - 1) === '!';
    const text = block.text.slice(open + 1, close);
    links.push({ line: lineAt(block, close + 1), text, target, ...parts, image });
  }
  return links;
}

/** Splits one markdown text into lines, fences, table rows, spans, relative links and headings. */
export function parseMarkdown(source: string): MarkdownDoc {
  const rows = source.replace(/\r\n?/g, '\n').split('\n');
  if (rows.at(-1) === '') rows.pop();
  const { lines, fences } = classify(rows);
  const prose = lines.filter((l) => l.kind === 'prose');
  const tableRows = lines.filter((l) => l.kind === 'table').map(toTableRow);
  const headings = prose.flatMap((l) => toHeading(l) ?? []);
  const spans: Span[] = [];
  const links: Link[] = [];
  for (const block of toBlocks(lines)) {
    const scan = scanSpans(block);
    spans.push(...scan.spans);
    links.push(...scanLinks(block, scan.masked));
  }
  return { lines, prose, fences, tableRows, spans, links, headings };
}

/**
 * The markdown files git would track under `root`, as repo-relative posix paths in git's order:
 * the index and every file it does not ignore, so a page a task adds is read before its commit. A
 * path the index holds but the work tree no longer does is left out.
 *
 * @throws {Error} when `git ls-files` fails, such as outside a work tree.
 */
export function listTrackedMarkdown(root: string = REPO_ROOT): readonly string[] {
  const run = Bun.spawnSync(['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (run.exitCode !== 0) throw new Error(`git ls-files failed: ${run.stderr.toString().trim()}`);
  const files = new Set(run.stdout.toString().split('\0')
    .filter(Boolean));
  return [...files].filter((file) => existsSync(join(root, file)));
}

/** The planning documents: the setup prompt, its review prompts, and `docs/specs/` and `docs/plans/`. */
const PLANNING_DOC = /^(?:setup-prompt(?:-review)?\.md|schema-survey-review\.md|docs\/(?:specs|plans)\/.+\.md)$/;

/**
 * True for a planning document. A plan names the files its work will create, so the paths and
 * quoted-code checks, which require every named file to exist, skip these files; the width and
 * link checks still read them.
 */
export function isPlanningDoc(file: string): boolean {
  return PLANNING_DOC.test(file);
}

/** Every tracked markdown file under `root`, read and parsed. */
export function readTrackedMarkdown(root: string = REPO_ROOT): readonly TrackedDoc[] {
  return listTrackedMarkdown(root).map((file) => ({
    file,
    ...parseMarkdown(readFileSync(join(root, file), 'utf8')),
  }));
}

/**
 * The repo-relative path a link's path names, read from the folder of `file`; the file itself for
 * a link to an anchor in it. A path that climbs out of the checkout keeps its leading `..`.
 */
export function resolveLink(file: string, link: Pick<Link, 'path'>): string {
  if (link.path === '') return file;
  if (link.path.startsWith('/')) return posix.normalize(link.path.slice(1));
  return posix.normalize(posix.join(posix.dirname(file), link.path));
}
