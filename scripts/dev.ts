/**
 * `bun run dev`: the service with live code, for patching it while it runs.
 *
 * - It builds the web app once, the same way `bun run build:web` does, and stops on a failure.
 * - It starts the HTTP service under `bun --watch`, which restarts it whenever a file it imports
 *   changes, so a backend edit is live as soon as it is saved.
 * - It watches `src/` and builds the web app again after each change, so a browser reload shows
 *   an edit to the app. The service reads the build from disk on every request, so it needs no
 *   restart for it. Changes inside {@link WEB_DIST} are the build's own and are not watched.
 *
 * Ctrl+C stops the watcher and the service together.
 *
 * @module
 */

import type { Subprocess } from 'bun';

import { watch } from 'node:fs';
import { join, sep } from 'node:path';

import { PROJECT_ROOT } from './build-web.ts';

/** The folder the watcher reads, relative to the checkout root. */
export const WATCHED_DIR = 'src';

/** The web build's folder, relative to {@link WATCHED_DIR}: the watcher's own output. */
export const WEB_DIST = join('web', 'dist');

/** How long the watcher waits after the last change before it builds, in milliseconds. */
export const REBUILD_DELAY_MS = 150;

/** The command that builds the web app: the `build:web` script's own. */
const BUILD_COMMAND = ['bun', 'scripts/build-web.ts'] as const;

/** The command that runs the service and restarts it on a backend change. */
const SERVE_COMMAND = ['bun', '--watch', 'src/http/server.ts'] as const;

/**
 * Whether a change the watcher reports should rebuild the web app: any file under
 * {@link WATCHED_DIR} but the build's own output.
 *
 * @param path - The changed file, relative to {@link WATCHED_DIR}, as `fs.watch` reports it.
 * @returns True when the app should be built again.
 */
export function shouldRebuild(path: string | null): boolean {
  if (path === null || path === '') return true;
  return path !== WEB_DIST && !path.startsWith(`${WEB_DIST}${sep}`);
}

/** A build run in a queue: it resolves once the build is over, and rejects if it crashed. */
export type BuildRun = () => Promise<void>;

/** Where a crashed build is reported: this terminal, so the watcher keeps running. */
function reportCrash(failure: unknown): void {
  console.error('dev: the web build crashed:', failure);
}

/**
 * Runs `build` after the changes settle, one build at a time. A change during a build asks for
 * one more build after it, however many changes arrive, so the last edit is always built and
 * no two builds write the folder at once. A build that crashes is reported, and the next
 * change builds again.
 *
 * @param build - Runs one build.
 * @param delayMs - The quiet time after the last change before a build starts.
 * @param onCrash - Receives the failure of a build that rejected.
 * @returns The function to call on every change.
 */
export function rebuildQueue(
  build: BuildRun,
  delayMs: number = REBUILD_DELAY_MS,
  onCrash: (failure: unknown) => void = reportCrash,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;

  const start = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await build();
    } catch (failure: unknown) {
      onCrash(failure);
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      await start();
    }
  };

  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => void start(), delayMs);
  };
}

/** Builds the web app in a child process, with its output on this terminal; true on success. */
async function buildOnce(): Promise<boolean> {
  const child = Bun.spawn([...BUILD_COMMAND], { cwd: PROJECT_ROOT, stdout: 'ignore', stderr: 'inherit' });
  return (await child.exited) === 0;
}

async function main(): Promise<void> {
  if (!(await buildOnce())) process.exit(1);
  console.error('dev: web app built; starting the service under bun --watch');

  const service: Subprocess = Bun.spawn([...SERVE_COMMAND], { cwd: PROJECT_ROOT, stdout: 'inherit', stderr: 'inherit' });
  const rebuild = rebuildQueue(async () => {
    const built = await buildOnce();
    console.error(built
      ? 'dev: web app rebuilt; reload the page'
      : 'dev: web build failed; fix the file named above');
  });
  const watcher = watch(join(PROJECT_ROOT, WATCHED_DIR), { recursive: true }, (_event, file) => {
    if (shouldRebuild(file)) rebuild();
  });

  const stop = (): void => {
    watcher.close();
    service.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await service.exited;
  watcher.close();
}

if (import.meta.main) {
  await main();
}
