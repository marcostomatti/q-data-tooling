/**
 * Builds the web app: `src/web/index.html` and everything it pulls in, CSS
 * through Tailwind 4, into one output directory.
 *
 * Usage: `bun scripts/build-web.ts [--outdir=<dir>]` (default `src/web/dist`).
 * Exits non-zero when the build fails or logs any error.
 *
 * {@link tailwindHoistingImports} compiles `src/web/styles.css` through
 * `bun-plugin-tailwind`. That entry imports the component library's
 * stylesheet, whose `@source "../"` points the scan at the library's `dist/`,
 * so the utilities its variants use are generated here. The library takes
 * React as a peer dependency, so the bundle holds this project's one copy.
 *
 * @module
 */
import type { BuildConfig, BuildOutput, BunPlugin } from 'bun';

import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import tailwind from 'bun-plugin-tailwind';

/** The checkout root. */
export const PROJECT_ROOT: string = resolve(dirname(import.meta.path), '..');

/** The HTML entry of the web app. */
export const WEB_ENTRY: string = resolve(PROJECT_ROOT, 'src/web/index.html');

/** Where `build:web` writes when no `--outdir` is given. */
export const DEFAULT_OUTDIR: string = resolve(PROJECT_ROOT, 'src/web/dist');

/** A remote `@import url(...)` statement left in Tailwind's output. */
const URL_IMPORT = /@import\s+url\((?:"[^"]*"|'[^']*'|[^)]*)\)[^;]*;/g;

/**
 * Moves every `@import url(...)` statement to the top of a stylesheet.
 *
 * Tailwind inlines local imports and leaves a remote one (the library's
 * Google Fonts import) where it stood, after thousands of lines of rules.
 * Bun's CSS parser rejects that: `@import rules must come before any other
 * rules except @charset and @layer`.
 */
export function hoistUrlImports(css: string): string {
  const imports = css.match(URL_IMPORT);
  if (imports === null) {
    return css;
  }
  return `${imports.join('\n')}\n${css.replace(URL_IMPORT, '')}`;
}

/**
 * `bun-plugin-tailwind`, with {@link hoistUrlImports} applied to every
 * stylesheet it generates.
 */
export const tailwindHoistingImports: BunPlugin = {
  name: 'tailwind-hoisting-imports',
  setup(build) {
    const onLoad: typeof build.onLoad = (constraints, callback) => build.onLoad(constraints, async (args) => {
      const result = await callback(args);
      if (result === undefined || !('contents' in result)) {
        return result;
      }
      if (typeof result.contents !== 'string') {
        return result;
      }
      return { ...result, contents: hoistUrlImports(result.contents) };
    });
    const wrapped = new Proxy(build, {
      get(target, property) {
        if (property === 'onLoad') {
          return onLoad;
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function'
          ? value.bind(target)
          : value;
      },
    });
    return tailwind.setup(wrapped);
  },
};

/** Options for {@link buildWeb}. */
export interface BuildWebOptions {
  /** Directory the bundle is written to. */
  outdir: string
  /** Entries to build; defaults to {@link WEB_ENTRY}. */
  entrypoints?: string[]
  /** Source map mode; defaults to `'none'`. */
  sourcemap?: BuildConfig['sourcemap']
}

/**
 * The prefix of every chunk the built `index.html` loads. The server answers
 * `/filings/:cik` with the same `index.html`, so a relative `./chunk.css`
 * there would resolve to `/filings/chunk.css` and come back as HTML; named
 * from the root, the chunks load on every page.
 */
const PUBLIC_PATH = '/';

/**
 * Builds the web app into `outdir`, minified, through Tailwind, with each
 * chunk loaded from the root. Never throws on a build error: the caller reads
 * `success` and `logs` on the returned output.
 */
export async function buildWeb(options: BuildWebOptions): Promise<BuildOutput> {
  return Bun.build({
    entrypoints: options.entrypoints ?? [WEB_ENTRY],
    outdir: options.outdir,
    publicPath: PUBLIC_PATH,
    minify: true,
    sourcemap: options.sourcemap ?? 'none',
    plugins: [tailwindHoistingImports],
    throw: false,
  });
}

/** True when the build failed or any of its logs is an error. */
export function hasBuildError(output: BuildOutput): boolean {
  return !output.success || output.logs.some((log) => log.level === 'error');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { outdir: { type: 'string' } },
    strict: true,
  });
  const outdir = values.outdir === undefined
    ? DEFAULT_OUTDIR
    : resolve(values.outdir);

  // Bun names its chunks by content hash and never clears the directory, so
  // the default one is emptied first: otherwise every rebuild leaves the last
  // build's chunks beside the new ones. A directory named by --outdir is the
  // caller's, so it is left as it is.
  if (outdir === DEFAULT_OUTDIR) {
    await rm(outdir, { recursive: true, force: true });
  }
  const output = await buildWeb({ outdir });
  for (const log of output.logs) {
    console.error(log);
  }
  if (hasBuildError(output)) {
    console.error('build:web failed');
    process.exit(1);
  }
  for (const artifact of output.outputs) {
    console.log(artifact.path);
  }
}

if (import.meta.main) {
  await main();
}
