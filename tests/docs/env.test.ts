/**
 * The environment check: every variable the source reads is named in `.env.example` and in the
 * configuration table of `docs/setup.md`, the table under its `Configuration` heading, and every
 * variable those two name is read in `src/`, `scripts/` or a `docker-compose*.yaml`.
 *
 * The source is the code git would track under `src/` and `scripts/`, test files left out. In
 * TypeScript a read is a property or index of `process.env`, of `Bun.env` or of a value declared
 * with an environment's type, `NodeJS.ProcessEnv` or `Record<string, string | undefined>`, or set
 * to the environment itself, as a dependency's compiled `env = process.env` default parameter is:
 * `.NAME`, `?.NAME`, `['NAME']`, `[CONST]` with `CONST` a string constant of the same file, or the
 * string after it in a call such as `value(env, 'NAME')`. A `Record<string, string>` is an
 * environment the code builds for a child, not one it reads, so the `PG*` names the backup passes
 * to `pg_dump` do not count. In a shell script a read is `${NAME:-...}`, the form `set -u` needs
 * for a variable that may be unset, and in a compose file it is any `${NAME...}`. Comment lines
 * are not read.
 *
 * `.env.example` names a variable by a line `NAME=` or `# NAME=`, not by a mention in a comment.
 * The table names one by the first cell of a body row. A row whose `Read by` cell names a
 * dependency, as `the <name> package`, is also read where that package's code reads it, since a
 * variable such as `LOG_REDACT` is read by a dependency and by nothing in this tree.
 *
 * `PATH` and `NODE_ENV` are set by the shell and by `bun test`, never in a `.env`, so they need a
 * table row and no `.env.example` line.
 *
 * @module
 */

import type { MarkdownDoc } from './markdown';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { parseMarkdown, readTrackedMarkdown, REPO_ROOT } from './markdown';

/** The variables the shell and the runner set, which `.env.example` leaves out. */
const AMBIENT: ReadonlySet<string> = new Set(['PATH', 'NODE_ENV']);

const NAME = '[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*';
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;
const ENV_TYPE = /\b(\w+)\??:\s*(?:Readonly<)?(?:NodeJS\.ProcessEnv|Record<string, string \| undefined>)/g;
const ENV_ALIAS = /\b(\w+)\s*=\s*(?:process|Bun)\.env\b(?!\s*(?:\.|\?\.|\[))/g;
const STRING_CONST = new RegExp(`\\bconst\\s+(\\w+)\\s*=\\s*'(${NAME})'`, 'g');
const SHELL_READ = new RegExp(`\\$\\{(${NAME}):?-`, 'g');
const COMPOSE_READ = new RegExp(`(?<!\\$)\\$\\{(${NAME})`, 'g');
const EXAMPLE_LINE = new RegExp(`^(?:# ?)?(${NAME})=`);
const PACKAGE_NAMED = /\bthe ([\w.-]+) package\b/g;
const CODE_FILE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const TEST_FILE = /\.test\.[jt]sx?$/;

/** One body row of the configuration table: the variable and the cell naming what reads it. */
export interface ConfigRow {
  readonly line: number
  readonly name: string
  readonly readBy: string
}

/** What the check reads: the reads of the tree, the two lists, and what each dependency reads. */
export interface EnvInput {
  /** Each variable the source under `src/` and `scripts/` reads, with the files that read it. */
  readonly sourceReads: ReadonlyMap<string, readonly string[]>
  /** Each variable a `docker-compose*.yaml` reads. */
  readonly composeReads: ReadonlySet<string>
  /** The variables `.env.example` names, in file order. */
  readonly example: readonly string[]
  readonly table: readonly ConfigRow[]
  /** The variables each dependency's code reads, keyed by the name a `Read by` cell gives it. */
  readonly packageReads: ReadonlyMap<string, ReadonlySet<string>>
}

/** One entry per miss, each naming the variable and where it was read or named. */
export interface EnvScan {
  readonly notInExample: readonly string[]
  readonly notInTable: readonly string[]
  readonly unread: readonly string[]
}

/** The lines of `text` that are not comment lines. */
function codeLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');
}

/** Escapes `text` for use inside a regular expression. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first capture group of every match of `pattern` in `text`. */
function captures(text: string, pattern: RegExp): readonly string[] {
  return [...text.matchAll(pattern)].flatMap((match) => match[1] === undefined
    ? []
    : [match[1]]);
}

/** The variables one TypeScript or JavaScript file reads, by the rules in the module comment. */
export function codeReads(source: string): ReadonlySet<string> {
  const text = codeLines(source);
  const constants = new Map([...text.matchAll(STRING_CONST)].map((match) => [match[1] ?? '', match[2] ?? '']));
  const declared = [...captures(text, ENV_TYPE), ...captures(text, ENV_ALIAS)];
  const holders = ['process.env', 'Bun.env', ...new Set(declared)].map(escaped).join('|');
  const read = (tail: string): RegExp => new RegExp(`(?<![\\w$])(?:${holders})${tail}`, 'g');
  const direct = [
    ...captures(text, read(`\\??\\.(${NAME})\\b`)),
    ...captures(text, read(`\\[\\s*'(${NAME})'\\s*\\]`)),
    ...captures(text, new RegExp(`\\w\\(\\s*(?:${holders})\\s*,\\s*'(${NAME})'`, 'g')),
  ];
  const viaConstant = captures(text, read('\\[\\s*(\\w+)\\s*\\]')).flatMap((constant) => {
    const name = constants.get(constant);
    return name === undefined
      ? []
      : [name];
  });
  return new Set([...direct, ...viaConstant]);
}

/** The variables one shell script reads with a default expansion. */
export function shellReads(source: string): ReadonlySet<string> {
  return new Set(captures(codeLines(source), SHELL_READ));
}

/** The variables one compose file interpolates. */
export function composeReads(source: string): ReadonlySet<string> {
  return new Set(captures(codeLines(source), COMPOSE_READ));
}

/** The variables `.env.example` names by a `NAME=` or `# NAME=` line, in file order. */
export function exampleNames(source: string): readonly string[] {
  return source.split('\n').flatMap((line) => {
    const name = EXAMPLE_LINE.exec(line)?.[1];
    return name === undefined
      ? []
      : [name];
  });
}

/**
 * The body rows of the first table under the `Configuration` heading, backticks taken off the
 * variable; `undefined` when the heading is missing.
 */
export function configurationRows(doc: Pick<MarkdownDoc, 'headings' | 'tableRows'>): readonly ConfigRow[] | undefined {
  const index = doc.headings.findIndex((h) => h.text === 'Configuration');
  const heading = doc.headings[index];
  if (heading === undefined) return undefined;
  const end = doc.headings[index + 1]?.line ?? Number.POSITIVE_INFINITY;
  const rows = doc.tableRows.filter((row) => row.line > heading.line && row.line < end);
  return rows
    .slice(1)
    .filter((row) => !row.delimiter)
    .map((row) => ({
      line: row.line,
      name: (row.cells[0] ?? '').replace(/`/g, ''),
      readBy: row.cells[3] ?? '',
    }));
}

/** The dependency names a `Read by` cell gives, as `the <name> package`. */
export function packagesNamed(readBy: string): readonly string[] {
  return captures(readBy, PACKAGE_NAMED);
}

/** Pure scan: both directions of the check over one {@link EnvInput}. */
export function scanEnv(input: EnvInput): EnvScan {
  const example = new Set(input.example);
  const tabled = new Set(input.table.map((row) => row.name));
  const readHere = (name: string): boolean => input.sourceReads.has(name) || input.composeReads.has(name);
  const sources = [...input.sourceReads].map(([name, files]) => ({ name, where: files.join(', ') }));
  const readByPackage = (row: ConfigRow): boolean => packagesNamed(row.readBy)
    .some((name) => input.packageReads.get(name)?.has(row.name) === true);
  const packageRead = new Set(input.table.filter(readByPackage).map((row) => row.name));
  return {
    notInExample: sources
      .filter(({ name }) => !example.has(name) && !AMBIENT.has(name))
      .map(({ name, where }) => `${name} (${where})`),
    notInTable: sources.filter(({ name }) => !tabled.has(name)).map(({ name, where }) => `${name} (${where})`),
    unread: [
      ...input.example.filter((name) => !readHere(name) && !packageRead.has(name)).map((name) => `.env.example ${name}`),
      ...input.table
        .filter((row) => !readHere(row.name) && !readByPackage(row))
        .map((row) => `docs/setup.md:${row.line} ${row.name}`),
    ],
  };
}

/** The files git would track that match `pathspecs`, repo-relative, in git's order. */
function trackedFiles(...pathspecs: string[]): readonly string[] {
  const run = Bun.spawnSync(['git', '-C', REPO_ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (run.exitCode !== 0) throw new Error(`git ls-files failed: ${run.stderr.toString().trim()}`);
  return [...new Set(run.stdout.toString().split('\0')
    .filter(Boolean))];
}

/** The reads of the source under `src/` and `scripts/`, each with the files that read it. */
function readSourceReads(): ReadonlyMap<string, readonly string[]> {
  const reads = new Map<string, string[]>();
  for (const file of trackedFiles('src', 'scripts')) {
    if (TEST_FILE.test(file)) continue;
    const text = (): string => readFileSync(join(REPO_ROOT, file), 'utf8');
    const names = CODE_FILE.test(file)
      ? codeReads(text())
      : file.endsWith('.sh')
        ? shellReads(text())
        : new Set<string>();
    for (const name of names) reads.set(name, [...(reads.get(name) ?? []), file]);
  }
  return reads;
}

/** Every code file under `dir`, at any depth. */
function codeFilesUnder(dir: string): readonly string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => CODE_FILE.test(file) && !file.split('/').includes('node_modules'))
    .map((file) => join(dir, file));
}

/** What each dependency of `package.json` reads, keyed by its full name and its unscoped name. */
function readPackageReads(names: readonly string[]): ReadonlyMap<string, ReadonlySet<string>> {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  const reads = new Map<string, ReadonlySet<string>>();
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const short = dependency.split('/').at(-1) ?? dependency;
    if (!names.includes(short) && !names.includes(dependency)) continue;
    const files = codeFilesUnder(join(REPO_ROOT, 'node_modules', dependency));
    const found = new Set(files.flatMap((file) => [...codeReads(readFileSync(file, 'utf8'))]));
    reads.set(dependency, found);
    reads.set(short, found);
  }
  return reads;
}

describe('the read rules (failing control)', () => {
  test('codeReads reads every form and skips comments and built environments', () => {
    const source = [
      'const KEY = \'GAMMA\';',
      '// process.env.IN_COMMENT',
      ' * process.env.IN_DOC',
      'const a = process.env.ALPHA ?? Bun.env[\'BETA\'];',
      'function f(env: NodeJS.ProcessEnv, other: Record<string, string>) {',
      '  return [env[KEY], value(env, \'DELTA\'), env.EPSILON, other.PGHOST, env.lower];',
      '}',
      'function g(vars?: Record<string, string | undefined>) { return vars?.ZETA ?? vars[\'ETA\']; }',
    ].join('\n');

    expect([...codeReads(source)].sort()).toEqual(['ALPHA', 'BETA', 'DELTA', 'EPSILON', 'ETA', 'GAMMA', 'ZETA']);
  });

  test('codeReads reads through a value set to the environment, as compiled JavaScript defaults a parameter', () => {
    const source = [
      'function h(env = process.env) { return env.THETA ?? value(env, \'IOTA\'); }',
      'const copy = { ...process.env }; const other = settings; other.KAPPA; copy.LAMBDA;',
      'const vars = process.env ?? {}; vars.MU; const one = process.env.NU; one.XI;',
    ].join('\n');

    expect([...codeReads(source)].sort()).toEqual(['IOTA', 'MU', 'NU', 'THETA']);
  });

  test('shellReads and composeReads read only their forms', () => {
    const shell = '# ${IN_COMMENT:-}\nif [ -n "${ALPHA:-}" ]; then x="$BETA ${BASH_SOURCE[0]} ${GAMMA-x}"; fi';
    const compose = '# ${IN_COMMENT}\nports:\n  - \'${ALPHA:-5432}:5432\'\n  x: ${BETA}\n  y: $${ESCAPED}';

    expect([...shellReads(shell)].sort()).toEqual(['ALPHA', 'GAMMA']);
    expect([...composeReads(compose)].sort()).toEqual(['ALPHA', 'BETA']);
  });

  test('exampleNames reads assignment lines and not mentions', () => {
    const source = '# Set ALPHA=1 if you like.\n# ALPHA=1\nBETA=\n#   GAMMA is mentioned\n# DELTA=x y';
    expect(exampleNames(source)).toEqual(['ALPHA', 'BETA', 'DELTA']);
  });
});

describe('scanEnv (failing control)', () => {
  const setup = parseMarkdown([
    '# Setup',
    '',
    '## Configuration',
    '',
    '| Variable | Default | What it does | Read by |',
    '| --- | --- | --- | --- |',
    '| `ALPHA` | unset | a | `src/a.ts` |',
    '| `PATH` | shell | b | `src/a.ts` |',
    '| `REDACT` | unset | c | the logger package |',
    '| `STALE` | unset | d | `src/gone.ts` |',
    '| `PORT_C` | `1` | e | `docker-compose.yaml` |',
    '',
    '## Commands',
    '',
    '| Script | Runs |',
    '| --- | --- |',
    '| `BETA` | x |',
  ].join('\n'));
  const table = configurationRows(setup) ?? [];
  const input: EnvInput = {
    sourceReads: new Map([['ALPHA', ['src/a.ts']], ['PATH', ['src/a.ts']], ['BETA', ['src/b.ts', 'scripts/c.ts']]]),
    composeReads: new Set(['PORT_C']),
    example: ['ALPHA', 'OLD'],
    table,
    packageReads: new Map([['logger', new Set(['REDACT'])]]),
  };

  test('reads the body rows of the table under the Configuration heading only', () => {
    expect(table.map((row) => row.name)).toEqual(['ALPHA', 'PATH', 'REDACT', 'STALE', 'PORT_C']);
    expect(packagesNamed(table[2]?.readBy ?? '')).toEqual(['logger']);
    expect(configurationRows(parseMarkdown('# Setup\n\n| a |\n| --- |\n| `b` |'))).toBeUndefined();
  });

  test('reports exactly the planted misses in both directions', () => {
    expect(scanEnv(input)).toEqual({
      notInExample: ['BETA (src/b.ts, scripts/c.ts)'],
      notInTable: ['BETA (src/b.ts, scripts/c.ts)'],
      unread: ['.env.example OLD', 'docs/setup.md:10 STALE'],
    });
  });

  test('a package read counts only for the package its row names', () => {
    const elsewhere = { ...input, example: [...input.example, 'REDACT'], packageReads: new Map([['other', new Set(['REDACT'])]]) };
    expect(scanEnv(elsewhere).unread).toContain('docs/setup.md:9 REDACT');
    expect(scanEnv(elsewhere).unread).toContain('.env.example REDACT');
  });

  test('an .env.example name is read when the package its table row names reads it', () => {
    const listed = { ...input, example: [...input.example, 'REDACT'] };
    expect(scanEnv(listed).unread).not.toContain('.env.example REDACT');
  });

  test('passes once every read is listed and every listed name is read', () => {
    const fixed: EnvInput = {
      ...input,
      sourceReads: new Map([...input.sourceReads, ['STALE', ['src/s.ts']], ['OLD', ['src/o.ts']]]),
      example: ['ALPHA', 'OLD', 'BETA', 'STALE'],
      table: [...table, { line: 12, name: 'BETA', readBy: '' }, { line: 13, name: 'OLD', readBy: '' }],
    };
    expect(scanEnv(fixed)).toEqual({ notInExample: [], notInTable: [], unread: [] });
  });
});

describe('the checkout (real)', () => {
  const setup = readTrackedMarkdown().find((doc) => doc.file === 'docs/setup.md');
  const table = setup === undefined
    ? undefined
    : configurationRows(setup);
  const sourceReads = readSourceReads();
  const composed = new Set(trackedFiles('docker-compose*.yaml')
    .flatMap((file) => [...composeReads(readFileSync(join(REPO_ROOT, file), 'utf8'))]));
  const example = exampleNames(readFileSync(join(REPO_ROOT, '.env.example'), 'utf8'));
  const packageReads = readPackageReads((table ?? []).flatMap((row) => packagesNamed(row.readBy)));
  const scan = scanEnv({ sourceReads, composeReads: composed, example, table: table ?? [], packageReads });

  test('reads variables from the source, the compose files and both lists', () => {
    expect(table).toBeDefined();
    expect(sourceReads.size).toBeGreaterThan(10);
    expect(composed.size).toBeGreaterThan(0);
    expect(example.length).toBeGreaterThan(10);
    expect(packageReads.size).toBeGreaterThan(0);
  });

  test('every ambient variable is still read by the source', () => {
    expect([...AMBIENT].filter((name) => !sourceReads.has(name))).toEqual([]);
  });

  test('every variable the source reads is in .env.example', () => {
    expect(scan.notInExample).toEqual([]);
  });

  test('every variable the source reads is in the configuration table of docs/setup.md', () => {
    expect(scan.notInTable).toEqual([]);
  });

  test('every variable the two name is read in src/, scripts/ or a compose file', () => {
    expect(scan.unread).toEqual([]);
  });
});
