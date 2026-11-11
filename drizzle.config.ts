/**
 * drizzle-kit's configuration, derived from the active dialect: the `#db` entry of
 * `package.json`'s `imports` names a dialect folder (`./src/data/<folder>/index.ts`), and that
 * folder decides drizzle-kit's dialect, the schema it reads (`./src/data/<folder>/tables`) and the
 * folder its migrations go to (`./drizzle/<folder>`). Switching `#db` switches all three, so
 * `bun run db:generate` writes the migrations of whichever dialect is built.
 *
 * `DATABASE_URL` is passed on as the credentials when it is set; `generate` needs none.
 *
 * @module
 */

import { defineConfig } from 'drizzle-kit';

import packageJson from './package.json' with { type: 'json' };

/** drizzle-kit's dialect name for each dialect folder under `src/data/`. */
const KIT_DIALECTS = {
  sqlite: 'sqlite',
  pg: 'postgresql',
} as const;

/** A dialect folder under `src/data/`. */
export type DialectFolder = keyof typeof KIT_DIALECTS;

/** The only shape of `#db` target this config reads: a dialect folder's `index.ts`. */
const TARGET_PATTERN = /^\.\/src\/data\/([a-z]+)\/index\.ts$/;

function isDialectFolder(name: string): name is DialectFolder {
  return Object.hasOwn(KIT_DIALECTS, name);
}

/**
 * The dialect folder a `#db` target names.
 *
 * @param target - The `#db` entry of `package.json`'s `imports`, such as `./src/data/sqlite/index.ts`.
 * @returns The folder name, `sqlite` or `pg`.
 * @throws When the target is not `./src/data/<folder>/index.ts` for a known dialect folder.
 */
export function dialectFolderOf(target: string): DialectFolder {
  const folder = TARGET_PATTERN.exec(target)?.[1];
  if (folder === undefined || !isDialectFolder(folder)) {
    throw new Error(`package.json's #db target ${JSON.stringify(target)} is not ./src/data/<sqlite|pg>/index.ts.`);
  }
  return folder;
}

/**
 * The drizzle-kit settings for a `#db` target: its dialect, schema folder and migrations folder.
 *
 * @param target - The `#db` entry of `package.json`'s `imports`.
 * @param url - The database URL to hand drizzle-kit, when there is one.
 * @returns The settings `defineConfig` takes.
 */
export function kitConfigFor(target: string, url: string | undefined) {
  const folder = dialectFolderOf(target);
  return {
    dialect: KIT_DIALECTS[folder],
    schema: `./src/data/${folder}/tables`,
    out: `./drizzle/${folder}`,
    ...(url === undefined
      ? {}
      : { dbCredentials: { url } }),
  };
}

export default defineConfig(kitConfigFor(packageJson.imports['#db'], process.env.DATABASE_URL));
