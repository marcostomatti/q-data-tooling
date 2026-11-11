# Switching the active dialect

The steps for making Postgres the build the app runs on, and for switching back to SQLite. Read
this when a task asks for either switch. The "Setup from zero" section of `docs/database.md` is
the short version for a person; this page is the checklist, with the checks that go after it.

## What `#db` decides

`#db` in `package.json`'s `imports` names one dialect's index: `./src/data/sqlite/index.ts` by
default, or `./src/data/pg/index.ts`. That one line decides five things:

- The schema the repositories read. `src/data/active.ts` re-exports the active dialect's tables,
  and nothing else names a dialect folder.
- The client `getDb()` opens, and the `DATABASE_URL` form it accepts.
- `drizzle.config.ts`, which reads the same entry with `dialectFolderOf`. It sets drizzle-kit's
  dialect, the schema folder `src/data/<folder>/tables` and the output `drizzle/<folder>/`.
- The migrations `bun run db:migrate` and `bun run db:status` read, from `migrationsFolderFor`.
- The typecheck. `bun run typecheck` checks the tree against the entry. `bun run typecheck:pg`
  always checks Postgres, through `tsconfig.pg.json`, whichever entry `#db` names.

## Switch to Postgres

1. In `package.json`, set `"#db": "./src/data/pg/index.ts"`. Change that entry and nothing else.
2. In `.env`, set `DATABASE_URL` to the Postgres URL in `.env.example`. SQLite refuses a
   `postgres://` URL, and the Postgres client throws `MissingDatabaseUrlError` when the variable is
   unset, so both halves must agree with `#db`.
3. Run `bun run db:up`, which starts the container in `docker-compose.yaml` and waits for it, then
   `bun run db:migrate`. On an empty container it logs `"applied":N` with N the count of every
   migration in `drizzle/pg/`.
4. Run `bun run db:status`. Every line should read `applied`, and it should exit 0.
5. Run the checks in the next section, with `TEST_PG_URL` naming the same server.

## Switch back to SQLite

1. In `package.json`, set `"#db": "./src/data/sqlite/index.ts"`.
2. In `.env`, set `DATABASE_URL` to `file:./data/app.db`, or remove the line. A `postgres://` URL
   left in place makes the SQLite client refuse to start.
3. Run `bun run db:migrate`. It applies `drizzle/sqlite/` to the file, and every migration when
   the file is new.
4. Run the checks in the next section.

## The data does not move

The two databases are separate, each with its own `__drizzle_migrations`, and the template has no
command that copies rows from one to the other. A switch starts the new dialect's database as it
is. Run `bun run backup` before a switch on a database that holds data, so a wrong switch can be
undone.

## Checks after a switch

Run `bun run typecheck && bun run typecheck:pg && bun run lint && bun test`, then `bun run test:db`.
`test:db` reads the active dialect from `#db` and runs the Postgres suites only when `TEST_PG_URL`
names a server that answers. It prints a line for each suite it leaves out, and a skipped
Postgres block under `bun test` is not a pass.

## Schema changes while the other dialect is active

`bun run db:generate` writes only the active dialect's folder. A table change needs the other
dialect's migration as well, which is drizzle-kit run with that dialect's flags, as
`.claude/skills/db/actions/add.md` step 4 gives them. Before any migrate, run
`bun test tests/data/journal.test.ts`: drizzle-orm 0.45 skips a migration whose `when` is not
later than the newest one applied, on both dialects. If `db:status` shows a line as `skipped` or
`unknown`, follow `.claude/skills/db/reference/migration-recovery.md`.

## Known limitations

SQLite does not enforce foreign keys, so a key that Postgres checks on a write or a delete is not
checked on SQLite. The Known limitations section of `.claude/skills/db/actions/add.md` says what
the implementor does about it.
