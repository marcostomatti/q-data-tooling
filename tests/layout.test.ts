import { readdirSync } from 'node:fs';
import { posix, join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const REPO_ROOT = join(import.meta.dir, '..');
const SOURCE_ROOT = 'src';

/** The built web bundle: generated, minified, and not ours to police. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['src/web/dist']);

// The layout's import rules are the lint rule `template/layer-imports`, in
// `eslint/rules/layer-imports.mjs`; this file keeps the directory-name check.

const under = (path: string, directory: string): boolean => path.startsWith(`${directory}/`);

/** The directory names the layout does not allow: `schemas/` anywhere, `schema/` under `src/data/`. */
function misplacedDirectory(directory: string): boolean {
  const name = posix.basename(directory);
  return name === 'schemas' || (name === 'schema' && under(directory, 'src/data'));
}

/** Reads the directories under `src/` as repo-relative posix paths, skipping the built web bundle. */
function readDirectories(): string[] {
  const directories: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })) {
      const path = posix.join(directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(path)) {
        directories.push(path);
        walk(path);
      }
    }
  };
  walk(SOURCE_ROOT);
  return directories;
}

describe('misplacedDirectory', () => {
  test('flags a schemas directory anywhere under src and a schema directory under src/data only', () => {
    // Built from parts so the stale-path grep over the repo does not match these fixtures.
    const schemas = 'src/' + 'schemas';
    const nested = 'src/routes/' + 'schemas';
    const dataSchema = 'src/data/pg/' + 'schema';
    expect([schemas, nested, dataSchema].filter(misplacedDirectory)).toEqual([schemas, nested, dataSchema]);
    expect(['src/data/pg/tables', 'src/routes/info', 'src/web/schema'].filter(misplacedDirectory)).toEqual([]);
  });
});

describe('the src tree', () => {
  const directories = readDirectories();

  test('is read: the walk sees the source directories and skips the built web bundle', () => {
    expect(directories).toContain('src/routes/info');
    expect(directories.some((path) => path.startsWith('src/web/dist'))).toBe(false);
  });

  test('holds no misplaced directory', () => {
    expect(directories.filter(misplacedDirectory)).toEqual([]);
  });
});
