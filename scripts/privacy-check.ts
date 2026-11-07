// Privacy check for this repository. Run: bun scripts/privacy-check.ts <dir>
/**
 * Privacy and secret scan of a folder, before anything in it reaches a public repo.
 *
 * Inside a git work tree only what git would track is read, the files `git ls-files -z --cached
 * --others --exclude-standard` lists, so an ignored folder such as `node_modules/` or `.tmp/` is
 * left unread. Outside one, and in a folder its work tree ignores, such as an export written under
 * `.tmp/`, every file is read. Text goes through the generic rules (and a denylist when one is
 * given), PNG and JPEG files are read for embedded text metadata, and any other binary is
 * reported once for a person to look at. A lockfile is read by every rule but the `word:` ones,
 * and in a GitHub Actions workflow the `word:` rules read each line without its top-level key.
 * gitleaks then scans the same folder. A finding prints as `file:line rule`, never the text that
 * matched, so the output can be shown and kept without repeating what it found.
 *
 * A binary a person has reviewed is listed in `.privacy-reviewed` (`sha256  path` per line) and
 * passes while its content still matches the hash; a changed binary is reported again.
 *
 * The denylist holds three kinds of line, read by {@link parseDenylist}:
 *
 * - `label<TAB>regex`: a rule, matched case-insensitively anywhere in a line.
 * - `word:<label><TAB>a|b|c`: word starts, matched case-insensitively against each word
 *   {@link words} cuts a line into, so `addThing` and `some_thing` hit a `thing` word and
 *   `underscore` does not hit the word it ends in. The finding is named `<label>`.
 * - `allow<TAB>phrase`: one exact phrase, taken out of a line before the `word:` rules read it,
 *   so the phrase is no hit and the same word elsewhere on the line still is.
 *
 * Usage: bun <this file> <dir> [--denylist <file>] [--reviewed <file>] [--no-gitleaks]
 * (or PRIVACY_DENYLIST=<file>)
 * Exit: 0 nothing found, 1 findings, 2 the scan could not run, which includes gitleaks missing
 * from `PATH` without `--no-gitleaks`. Under `--no-gitleaks` the last line printed is `gitleaks
 * did not run`, so a scan without it never reads as a whole one.
 *
 * Ported from the service repository's `scripts/privacy-check.ts`, with no address of its own in
 * {@link ALLOWED_EMAILS}, the reserved `.test`, `.example`, `.invalid` and `.localhost` domains
 * allowed, and the `word:` and `allow` kinds with the tokenizer of the domain-leak test that
 * `tests/privacy.test.ts` replaced. `bun run privacy` runs it over this repository.
 *
 * @module
 */
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

/** A `label<TAB>regex` rule: a finding wherever the pattern matches, unless `allow` says no. */
export type PatternRule = {
  readonly kind: 'pattern';
  readonly label: string;
  readonly pattern: RegExp;
  /** A match this returns true for is no finding. */
  readonly allow?: (match: string) => boolean;
};

/** A `word:<label>` rule: a finding wherever a word of the line starts with `start`. */
export type WordRule = {
  readonly kind: 'word';
  readonly label: string;
  /** Anchored at the start of a word and case-insensitive: `^(?:a|b|c)` with the `i` flag. */
  readonly start: RegExp;
  /** The denylist's `allow` phrases, taken out of a line before its words are read. */
  readonly allowed: readonly string[];
};

export type Rule = PatternRule | WordRule;

export type Finding = { readonly file: string; readonly line: number; readonly rule: string };

/** Reviewed binaries: path → sha256 of the content a person looked at. */
export type Reviewed = ReadonlyMap<string, string>;

const REVIEWED_FILE = '.privacy-reviewed';
const REVIEWED_LINE = /^([0-9a-f]{64})\s+(.+)$/;

/** `sha256  path` per line; `#` comments and blank lines skipped. */
export function parseReviewed(text: string): Reviewed {
  return new Map(text.split('\n').flatMap((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return [];
    const match = REVIEWED_LINE.exec(line);
    if (match === null) throw new Error(`reviewed list line ${index + 1}: expected "sha256  path"`);
    return [[match[2]!, match[1]!] as const];
  }));
}

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher('sha256').update(bytes)
  .digest('hex');

const EXIT_CLEAN = 0;
const EXIT_FOUND = 1;
const EXIT_FAILED = 2;
const BINARY_SNIFF_BYTES = 8000;
const IMAGE_FILE = /\.(png|jpe?g)$/i;
const NO_GITLEAKS = '--no-gitleaks';
const GITLEAKS_SKIPPED = 'gitleaks did not run';

/**
 * Lockfiles, by file name: package names, versions and hashes that no one writes by hand, cut by
 * {@link words} into fragments a `word:` rule can start on by chance. The other rules still read
 * them.
 */
const LOCKFILES = new Set(['bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']);

/** True when the file, at any depth, is a lockfile. */
export const isLockfile = (file: string): boolean => LOCKFILES.has(basename(file));

/** The rules that read a file: all of them, but no `word:` rule for a lockfile. */
const rulesFor = (file: string, rules: readonly Rule[]): readonly Rule[] => isLockfile(file)
  ? rules.filter((rule) => rule.kind !== 'word')
  : rules;

/** Addresses that are no finding, lower-cased. Empty: this repository names no one's address. */
export const ALLOWED_EMAILS: readonly string[] = [];

/**
 * Domains that are no finding: the RFC 2606 example domains, the reserved `.test`, `.example`,
 * `.invalid` and `.localhost` top-level domains, and GitHub's no-reply addresses.
 */
const ALLOWED_EMAIL_DOMAINS
  = /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com|(?:[a-z0-9-]+\.)*(?:test|example|invalid|localhost))$/i;
const NOREPLY_ADDRESS = /^no-?reply@/i;

const allowedEmail = (address: string): boolean => ALLOWED_EMAILS.includes(address.toLowerCase())
  || ALLOWED_EMAIL_DOMAINS.test(address)
  || NOREPLY_ADDRESS.test(address);

const OCTET = '\\d{1,3}';
const PRIVATE_PREFIX
  = `(?:10\\.${OCTET}|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168|100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7]))`;

export const GENERIC_RULES: readonly PatternRule[] = [
  {
    kind: 'pattern',
    label: 'private-ip',
    pattern: new RegExp(`(?<![\\d.])${PRIVATE_PREFIX}\\.${OCTET}\\.${OCTET}(?!\\d)`, 'g'),
  },
  {
    kind: 'pattern',
    label: 'home-path',
    pattern: /(?:\\?\/(?:Users|home)\\?\/|[A-Za-z]:\\{1,2}Users\\{1,2})(?!(?:tester|user|runner)(?![\w.-]))[A-Za-z0-9._-]+/g,
  },
  {
    kind: 'pattern',
    label: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allow: allowedEmail,
  },
  {
    kind: 'pattern',
    label: 'telegram-token',
    pattern: /(?<!\d)\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
  },
  { kind: 'pattern', label: 'telegram-chat', pattern: /(?<!\d)-100\d{9,}/g },
];

/**
 * Cuts a line into words: at every character that is not a letter, and between a lower-case
 * letter and an upper-case one, so `addThings`, `some_thing` and `x-thing-y` each yield their
 * parts. This is the "word-ish" boundary: a plain `\b` would miss a word inside camelCase or
 * after an underscore, and no boundary at all would flag `underscore`.
 */
export function words(line: string): readonly string[] {
  return line.split(/[^A-Za-z]+/).flatMap((part) => part.split(/(?<=[a-z])(?=[A-Z])/))
    .filter(Boolean);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The line with every allowed phrase, in any case, replaced by a space. */
export function withoutAllowed(line: string, allowed: readonly string[]): string {
  return allowed.reduce((rest, phrase) => rest.replaceAll(new RegExp(escapeRegExp(phrase), 'gi'), ' '), line);
}

const WORD_PREFIX = 'word:';
const ALLOW_LABEL = 'allow';

type DenylistLine = { readonly number: number; readonly label: string; readonly body: string };

function compiled(source: string, flags: string, number: number): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new Error(`denylist line ${number}: ${(error as Error).message}`, { cause: error });
  }
}

/** Every rule line split at its first tab; `#` comments and blank lines skipped. */
function denylistLines(text: string): readonly DenylistLine[] {
  return text.split('\n').flatMap((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return [];
    const tab = raw.indexOf('\t');
    if (tab < 0) throw new Error(`denylist line ${index + 1}: no tab between label and regex`);
    return [{ number: index + 1, label: raw.slice(0, tab).trim(), body: raw.slice(tab + 1).trim() }];
  });
}

function ruleOf(line: DenylistLine, allowed: readonly string[]): Rule {
  if (!line.label.startsWith(WORD_PREFIX)) {
    return { kind: 'pattern', label: line.label, pattern: compiled(line.body, 'gi', line.number) };
  }
  const label = line.label.slice(WORD_PREFIX.length).trim();
  if (label === '') throw new Error(`denylist line ${line.number}: a word: rule needs a label`);
  return { kind: 'word', label, start: compiled(`^(?:${line.body})`, 'i', line.number), allowed };
}

/**
 * The denylist's rules, one per `label<TAB>regex` or `word:<label><TAB>a|b|c` line, every `allow`
 * phrase given to each `word:` rule wherever it stands in the file; `#` comments and blank lines
 * skipped. A line labelled exactly `allow` is a phrase, never a rule.
 */
export function parseDenylist(text: string): readonly Rule[] {
  const lines = denylistLines(text);
  const allowed = lines.filter((line) => line.label === ALLOW_LABEL).map((line) => {
    if (line.body === '') throw new Error(`denylist line ${line.number}: an allow line needs a phrase`);
    return line.body;
  });
  return lines.filter((line) => line.label !== ALLOW_LABEL).map((line) => ruleOf(line, allowed));
}

function patternMatches(line: string, rule: PatternRule): boolean {
  const matches = line.match(new RegExp(rule.pattern.source, rule.pattern.flags.includes('g')
    ? rule.pattern.flags
    : `${rule.pattern.flags}g`));
  return (matches ?? []).some((match) => !(rule.allow?.(match) ?? false));
}

function wordMatches(line: string, rule: WordRule): boolean {
  return words(withoutAllowed(line, rule.allowed)).some((word) => rule.start.test(word));
}

/** A GitHub Actions workflow, at any depth: a `.yml` or `.yaml` file in `.github/workflows/`. */
const WORKFLOW_FILE = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;

/** True when the file is a GitHub Actions workflow. */
export const isWorkflow = (file: string): boolean => WORKFLOW_FILE.test(file);

/** A mapping key at column 0, with its colon. */
const TOP_LEVEL_KEY = /^[A-Za-z][\w-]*:/;

/**
 * The line the `word:` rules read. In a workflow a key at column 0 is one the workflow syntax
 * fixes, since GitHub rejects any other, so no one can reword it to pass a `word:` rule; that key
 * is taken out and its value and comment are still read. Any other file's line is read whole.
 */
export function wordLineOf(file: string, line: string): string {
  return isWorkflow(file)
    ? line.replace(TOP_LEVEL_KEY, ' ')
    : line;
}

function lineMatches(file: string, line: string, rule: Rule): boolean {
  return rule.kind === 'word'
    ? wordMatches(wordLineOf(file, line), rule)
    : patternMatches(line, rule);
}

/** One finding per line and rule that matches it. */
export function scanText(file: string, text: string, rules: readonly Rule[]): readonly Finding[] {
  return text.split('\n').flatMap((line, index) => rules.filter((rule) => lineMatches(file, line, rule))
    .map((rule) => ({ file, line: index + 1, rule: rule.label })));
}

/** PNG chunks that carry pixels and colour only; any other chunk may carry text. */
const PNG_SAFE_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'bKGD']);
/**
 * JPEG segments before the scan that carry image data only (APP0 JFIF, APP14 Adobe, tables,
 * frame headers).
 */
const JPEG_SAFE_MARKERS = new Set([
  0xe0, 0xee, 0xdb, 0xc4, 0xdd, 0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
  0xce, 0xcf,
]);
const JPEG_START_OF_SCAN = 0xda;

/** True when the PNG holds only safe chunks, ends at IEND and has nothing after it. */
function pngIsClean(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    if (!PNG_SAFE_CHUNKS.has(type)) return false;
    const next = at + 12 + length;
    if (type === 'IEND') return next === bytes.length;
    at = next;
  }
  return false;
}

/**
 * True when every segment before the scan is a safe one, with no fill bytes or stray data
 * between them.
 */
function jpegIsClean(bytes: Uint8Array): boolean {
  for (let at = 2; at + 4 <= bytes.length; ) {
    if (bytes[at] !== 0xff) return false;
    const marker = bytes[at + 1]!;
    if (marker === JPEG_START_OF_SCAN) return true;
    if (!JPEG_SAFE_MARKERS.has(marker)) return false;
    at += 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
  }
  return false;
}

const isPng = (bytes: Uint8Array): boolean => bytes[0] === 0x89 && bytes[1] === 0x50
  && bytes[2] === 0x4e && bytes[3] === 0x47;
const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === 0xd8;
const isImage = (bytes: Uint8Array): boolean => isPng(bytes) || isJpeg(bytes);

/**
 * An image holding anything beyond pixel and colour data (text, Exif, XMP, IPTC, comments,
 * trailing bytes) is one finding.
 */
export function imageMetadata(file: string, bytes: Uint8Array): readonly Finding[] {
  const found = (isPng(bytes) && !pngIsClean(bytes)) || (isJpeg(bytes) && !jpegIsClean(bytes));
  return found
    ? [{ file, line: 0, rule: 'image-metadata' }]
    : [];
}

type Entry = { readonly file: string; readonly path: string; readonly link: boolean };

/**
 * Variables that point git at a repository other than the one `-C <dir>` finds, as a git hook
 * sets them; the scan asks about the folder it was given, so they are dropped.
 */
const GIT_LOCATION = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']);

function git(dir: string, args: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION.has(name)));
  const run = Bun.spawnSync(['git', '-C', dir, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString().trim() };
}

/**
 * True when `dir` is in a git work tree that does not ignore it. A folder outside any work tree,
 * or one its work tree ignores, is not: git would list nothing in an ignored one.
 */
export function inWorkTree(dir: string): boolean {
  const inside = git(dir, ['rev-parse', '--is-inside-work-tree']);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return false;
  const ignored = git(dir, ['check-ignore', '-q', '.']);
  if (ignored.exitCode > 1) throw new Error(`git check-ignore failed: ${ignored.stderr}`);
  return ignored.exitCode === 1;
}

/**
 * What git would track under `dir`: the index and every file it does not ignore. A path the index
 * holds but the work tree no longer does is skipped, and so is a submodule, which is a folder.
 */
function trackedEntries(dir: string): readonly Entry[] {
  const listed = git(dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (listed.exitCode !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  const files = new Set(listed.stdout.split('\0').filter(Boolean));
  return [...files].flatMap((file) => {
    const path = join(dir, file);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined || stat.isDirectory()) return [];
    return [{ file, path, link: stat.isSymbolicLink() }];
  });
}

/** Every file and symlink under `dir`, at any depth. */
function entriesUnder(dir: string, top: string = dir): readonly Entry[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entriesUnder(path, top);
    if (entry.isSymbolicLink()) return [{ file: relative(top, path), path, link: true }];
    return entry.isFile()
      ? [{ file: relative(top, path), path, link: false }]
      : [];
  });
}

/**
 * Every file git would track under `dir` inside a work tree, and every file under it outside one,
 * paths in findings relative to it.
 */
export async function scanDir(
  dir: string,
  rules: readonly Rule[],
  reviewed: Reviewed = new Map(),
): Promise<readonly Finding[]> {
  const entries = inWorkTree(dir)
    ? trackedEntries(dir)
    : entriesUnder(dir);
  return entries.flatMap(({ file, path, link }) => {
    if (link) return [{ file, line: 0, rule: 'symlink-unreviewed' }];
    const bytes = new Uint8Array(readFileSync(path));
    const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
    if ((binary || isImage(bytes)) && reviewed.get(file) === sha256(bytes)) return [];
    if (IMAGE_FILE.test(file) && isImage(bytes)) return imageMetadata(file, bytes);
    if (binary) return [{ file, line: 0, rule: 'binary-unreviewed' }];
    return scanText(file, new TextDecoder().decode(bytes), rulesFor(file, rules));
  });
}

type GitleaksHit = { readonly File: string; readonly StartLine: number; readonly RuleID: string };

function gitleaks(dir: string): readonly Finding[] {
  const reportDir = mkdtempSync(join(tmpdir(), 'gitleaks-'));
  const report = join(reportDir, 'report.json');
  try {
    return gitleaksInto(dir, report);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}

function gitleaksInto(dir: string, report: string): readonly Finding[] {
  const run = Bun.spawnSync(
    [
      'gitleaks', 'dir', '--redact', '--no-banner', '--report-format', 'json', '--report-path', report,
      '--exit-code', '0', dir,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  if (run.exitCode !== 0) throw new Error(`gitleaks failed: ${run.stderr.toString().trim()}`);
  const hits = JSON.parse(readFileSync(report, 'utf8')) as readonly GitleaksHit[];
  return hits.map((hit) => ({ file: relative(dir, hit.File), line: hit.StartLine, rule: `gitleaks:${hit.RuleID}` }));
}

export function denylistPath(args: readonly string[]): string | undefined {
  const flag = args.indexOf('--denylist');
  if (flag >= 0 && (args[flag + 1] === undefined || args[flag + 1] === '')) throw new Error('--denylist needs a file');
  const path = flag >= 0
    ? args[flag + 1]
    : process.env.PRIVACY_DENYLIST;
  if (path === undefined || path === '') return undefined;
  if (!existsSync(path)) throw new Error('the denylist file named does not exist');
  return path;
}

function reviewedList(dir: string, args: readonly string[]): Reviewed {
  const flag = args.indexOf('--reviewed');
  if (flag >= 0 && (args[flag + 1] === undefined || args[flag + 1] === '')) throw new Error('--reviewed needs a file');
  const path = flag >= 0
    ? args[flag + 1]!
    : join(dir, REVIEWED_FILE);
  return existsSync(path)
    ? parseReviewed(readFileSync(path, 'utf8'))
    : new Map();
}

async function scan(args: readonly string[], withGitleaks: boolean): Promise<number> {
  const dir = args[0];
  if (dir === undefined || !existsSync(dir) || !statSync(dir).isDirectory()) {
    const self = relative(process.cwd(), process.argv[1] ?? 'this file');
    console.error(`usage: bun ${self} <dir> [--denylist <file>] [--reviewed <file>] [${NO_GITLEAKS}]`);
    return EXIT_FAILED;
  }
  if (withGitleaks && Bun.which('gitleaks') === null) {
    console.error(`scan could not run: gitleaks is not on PATH; install it, or pass ${NO_GITLEAKS} to scan without it`);
    return EXIT_FAILED;
  }
  try {
    const listed = denylistPath(args);
    const rules = [...GENERIC_RULES, ...(listed
      ? parseDenylist(readFileSync(listed, 'utf8'))
      : [])];
    const findings = [
      ...(await scanDir(dir, rules, reviewedList(dir, args))),
      ...(withGitleaks
        ? gitleaks(dir)
        : []),
    ];
    const lines = findings.map((f) => `${f.file}:${f.line} ${f.rule}`).sort();
    lines.forEach((line) => console.log(line));
    console.log(`${lines.length} finding(s)${listed
      ? ''
      : ' (no denylist)'}`);
    return lines.length === 0
      ? EXIT_CLEAN
      : EXIT_FOUND;
  } catch (error) {
    console.error(`scan could not run: ${(error as Error).message}`);
    return EXIT_FAILED;
  }
}

/** The scan, then, under `--no-gitleaks`, a last line saying gitleaks did not run, on any exit. */
async function main(args: readonly string[]): Promise<number> {
  const withGitleaks = !args.includes(NO_GITLEAKS);
  const code = await scan(args, withGitleaks);
  if (!withGitleaks) console.log(GITLEAKS_SKIPPED);
  return code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
