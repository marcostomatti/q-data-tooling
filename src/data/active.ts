/**
 * The active dialect: the one module that reads the `#db` alias, so every other module imports
 * the client, its chassis dependency and the schema from here and names no dialect folder.
 *
 * `#db` is the `imports` entry in `package.json`, which points at `./sqlite/index.ts` by default.
 * Pointing it at `./pg/index.ts` makes Postgres the active dialect. `bun run typecheck` checks the
 * tree against the entry `package.json` names; `bun run typecheck:pg` checks it with `#db` mapped
 * to `./pg/index.ts` by `tsconfig.pg.json`, so the dialect not in use still compiles.
 *
 * @module
 */
export { apiToken, appConfig, authSession, closeDb, companies, companyTickers, dbDependency, DIALECT, filings, getDb, transact, type DrizzleClient as ActiveClient } from '#db';
