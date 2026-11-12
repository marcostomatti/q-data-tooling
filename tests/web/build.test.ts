import type { BuildOutput } from 'bun';

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  buildWeb,
  hasBuildError,
  hoistUrlImports,
  PROJECT_ROOT,
} from '../../scripts/build-web.ts';

const BUILD_TIMEOUT_MS = 60_000;

/** A utility the library's `Button` variants use (`variant: 'primary'`). */
const BUTTON_UTILITY = /\.text-on-primary\{/;

/**
 * The `react` package's last two exports, `useTransition` then `version`,
 * which each minified copy of `react` carries once.
 */
const REACT_COPY = /useTransition\(\)\},[\w$]+\.version="/g;

/** An entry that renders the library's `Button` through `react-dom/client`. */
const LIBRARY_ENTRY = resolve(import.meta.dir, 'fixtures/library-entry.tsx');

/** A Tailwind entry without the library's stylesheet, so without its scan. */
const TAILWIND_ONLY_ENTRY = resolve(import.meta.dir, 'fixtures/tailwind-only.css');

let workdir = '';

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'build-web-'));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

/** The text of every file in `dir` whose name ends in `extension`. */
async function filesIn(dir: string, extension: string): Promise<string> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(extension));
  const texts = await Promise.all(names.map((name) => Bun.file(join(dir, name)).text()));
  return texts.join('\n');
}

function reactCopies(js: string): number {
  return js.match(REACT_COPY)?.length ?? 0;
}

describe('bun scripts/build-web.ts --outdir', () => {
  // A subprocess, as `build:web` runs it. In-process, the first Bun.build of
  // a `bun test` run that scanned for test files fails to resolve the app's
  // `../app-config.ts`.
  test('exits 0 and emits index.html, CSS with the Button utilities, and one React', async () => {
    const outdir = join(workdir, 'app');
    const build = Bun.spawnSync(['bun', 'scripts/build-web.ts', `--outdir=${outdir}`], {
      cwd: PROJECT_ROOT,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    expect(build.stderr.toString()).toBe('');
    expect(build.exitCode).toBe(0);
    expect(await readdir(outdir)).toContain('index.html');
    expect(await filesIn(outdir, '.css')).toMatch(BUTTON_UTILITY);
    expect(reactCopies(await filesIn(outdir, '.js'))).toBe(1);
    // A page under a path segment, such as /filings/320193, resolves a relative
    // `./chunk.css` to /filings/chunk.css, which the server answers with
    // index.html; a chunk named from the root loads on every page.
    const html = await Bun.file(join(outdir, 'index.html')).text();
    expect(html).toMatch(/href="\/chunk-[a-z0-9]+\.css"/);
    expect(html).toMatch(/src="\/chunk-[a-z0-9]+\.js"/);
  }, BUILD_TIMEOUT_MS);
});

describe('buildWeb', () => {
  test('a bundle importing the library holds one React', async () => {
    const outdir = join(workdir, 'library');
    const output = await buildWeb({ outdir, entrypoints: [LIBRARY_ENTRY] });

    expect(output.logs.map(String)).toEqual([]);
    expect(reactCopies(await filesIn(outdir, '.js'))).toBe(1);
  }, BUILD_TIMEOUT_MS);

  test('control: Tailwind without the library stylesheet emits no Button utility', async () => {
    const outdir = join(workdir, 'control-css');
    const output = await buildWeb({ outdir, entrypoints: [TAILWIND_ONLY_ENTRY] });

    expect(output.logs.map(String)).toEqual([]);
    expect(await filesIn(outdir, '.css')).not.toMatch(BUTTON_UTILITY);
  }, BUILD_TIMEOUT_MS);

  test('a missing entry is a build error', async () => {
    const output: BuildOutput = await buildWeb({
      outdir: join(workdir, 'missing'),
      entrypoints: [join(workdir, 'no-such-entry.tsx')],
    });

    expect(hasBuildError(output)).toBe(true);
  }, BUILD_TIMEOUT_MS);
});

describe('hoistUrlImports', () => {
  test('moves a remote import, semicolons in its URL included, to the top', () => {
    const font = '@import url("https://fonts.example/css2?family=A:wght@4;5&display=swap");';
    const css = `@layer theme;\n.a{color:red}\n${font}\n.b{color:blue}`;

    const hoisted = hoistUrlImports(css);

    expect(hoisted.startsWith(`${font}\n`)).toBe(true);
    expect(hoisted.split(font)).toHaveLength(2);
    expect(hoisted).toContain('.b{color:blue}');
  });

  test('leaves a stylesheet with no remote import unchanged', () => {
    const css = '@layer theme;\n.a{color:red}';

    expect(hoistUrlImports(css)).toBe(css);
  });
});

describe('the serve script', () => {
  // The server reads `src/web/dist` once, at start, and nothing else refreshes it, so a `serve`
  // that skips the build keeps showing whatever bundle the last manual build left.
  test('builds the web app before it starts the server', async () => {
    const manifest: unknown = await Bun.file(join(PROJECT_ROOT, 'package.json')).json();
    const scripts = (manifest as { scripts: Record<string, string> }).scripts;

    expect(scripts.serve).toBe('bun run build:web && bun src/http/server.ts');
  });
});
