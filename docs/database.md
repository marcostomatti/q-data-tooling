# Database

This page covers the database: the two dialects, the switch between them, the migrations that
build the schema, the seeds, and how to recover when the migration journal and the migration
files disagree.

**This project runs on Postgres.** `#db` points at `./src/data/pg/index.ts`, and the
[README](../README.md#setup-and-first-run) starts the database with `bun run db:up`. SQLite is
the template's default, which the sections below still describe. The tests that need a database
run on Postgres as well, as [integration tests](setup.md#the-integration-tests).

## What it is and when to turn it on

The service keeps its rows in one database, and every route that stores data reads and writes
it. The database is always on, and one of two dialects is active at a time:

- **SQLite**, the default. The database is one file, `./data/app.db` unless `DATABASE_URL` says
  otherwise. It needs no server and no Docker, which suits one service on one machine.
- **Postgres**, for when the data should live on a server, which `docker compose` can start
  for you. It is the same code with a different client and migrations.

The active dialect is the `#db` entry in `package.json`'s `imports`. It points at
`./src/data/sqlite/index.ts` by default. `src/data/active.ts` re-exports the active dialect's
tables and client, and every other module imports from `active.ts`, so no code names a
dialect folder. Changing that one entry switches the client, the schema the repositories read,
`drizzle.config.ts` and the migrations the migrate and status scripts read.

## Setup from zero

### SQLite

The clone and `.env` from [setup](setup.md) are enough. Then:

```sh
bun run db:migrate
bun run db:status
```

`db:migrate` creates `data/app.db` and its folder when they are missing, and applies the
migrations in `drizzle/sqlite/`. On a new file it logs `"applied":1`, and a second run logs
`database already up to date`. `db:status` prints one `applied` line for each migration file.

### Postgres

The Postgres switch changes three things: `#db`, `DATABASE_URL` and the database itself.

1. In `package.json`, set `"#db": "./src/data/pg/index.ts"`. Change that entry and nothing else.
2. In `.env`, uncomment the Postgres `DATABASE_URL` line in `.env.example`, and remove any
   `file:` URL. SQLite refuses a `postgres://` URL, and the Postgres client needs one.
3. Start the database with `bun run db:up`. It runs `docker compose up -d --wait` on
   `docker-compose.yaml`, which starts Postgres 16 on `127.0.0.1` and waits until it answers.
   The data lives in the volume `template-service-data`. Docker must be running.
4. Apply the migrations with `bun run db:migrate`, then check them with `bun run db:status`.
   On an empty container the migrate logs the count of every migration in `drizzle/pg/`.
5. Type-check both dialects with `bun run typecheck` and `bun run typecheck:pg`. The second
   always checks Postgres, whichever dialect `#db` names, so the dialect not in use still
   compiles.

If port 5432 is taken, set `DB_PORT` before `bun run db:up`, and the same port in
`DATABASE_URL`. [The gates](setup.md#the-gates) run `bun test`, which needs no database. The
tests that need one run with `bun run test:integration` (see
[the integration tests](setup.md#the-integration-tests)).

### Migrations

The schema lives in `src/data/sqlite/tables/` and `src/data/pg/tables/`, one file per dialect
and area. Migrations are generated from those files, and each dialect has its own folder:

- `bun run db:generate` writes the active dialect's migration into `drizzle/sqlite/` or
  `drizzle/pg/`. Pass a name for it with `--name`, as in `bun run db:generate --name add-orders`.
  Each run writes one `<NNNN>_<name>.sql` file and adds an entry to the dialect's journal,
  `meta/_journal.json`, and a snapshot of the schema.
- `bun run db:migrate` applies the pending files to the database `DATABASE_URL` names. It
  records each one as a row of `__drizzle_migrations`, in the `drizzle` schema on Postgres.
- `bun run db:status` compares the files with those rows and prints one line per migration.

The other dialect's migration is written with drizzle-kit and its own flags, which
`.claude/skills/db/actions/add.md`, step 4, gives. `bun run db:generate` writes only the
active dialect's folder.

A custom migration, such as a backfill, is written with
`bun run db:generate --custom --name backfill-<column>`. Its SQL goes below the header line,
on new lines, as `.claude/skills/db/reference/data-changes.md` explains.

### The journal

The journal, `drizzle/sqlite/meta/_journal.json` for SQLite and the same file under
`drizzle/pg/` for Postgres, lists the migrations in order, and each entry has a `when`
timestamp. The migrator reads only the newest `created_at` in
`__drizzle_migrations`, and it runs an entry only when its `when` is later than that. An entry
with an older `when`, such as one a merged branch generated, is never run, and nothing reports
it. `db:status` is the check that finds it, and `tests/data/journal.test.ts` guards the order of
the `when` stamps on both dialects.

A `/db add` appends a migration to the journal, so every check that reads the journal has to
hold after it. Run `bun test tests/data/journal.test.ts` before any migrate, and then
`bun run db:status`.

### Seeds

`bun run db:seed` runs the seed files in the `seeds` folder under `src/data/`, in file-name
order. The template ships no seed files; this service ships `01-companies.ts`, which loads the
SEC ticker list into `companies` and `company_tickers`. A missing folder means zero seeds, so
the command logs `no seeds ran` and exits 0. A seed file is named `<NN>-<name>.ts`, with two
digits, a dash and a lower-case kebab name. A file with any other name stops the run before any
seed runs. Each seed runs in its own transaction, so a seed that throws leaves none of its own
writes behind, and the run stops and names the file.

The runner records nothing, so every run runs every seed again. A seed must therefore insert
on its natural key with `onConflictDoNothing()`. A seed imports `appConfig` from
`src/data/active.ts` and the `Db` type from `src/data/repositories/db.ts`, so one file serves
both dialects. This one leaves a single row however many times the run happens:

```ts
// src/data/seeds/<NN>-<name>.ts
export async function seed(db: Db): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: 'example', value: { enabled: true } })
    .onConflictDoNothing();
}
```

Leave `updatedAt` out so its column default applies. Do not call `db.transaction`, because the
runner already wraps each seed in `transact`.

## Configuration

These are the database rows of the [configuration table](setup.md#configuration), with the
same meaning.

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `DATABASE_URL` | unset, `./data/app.db` | SQLite: `file:<path>` or `:memory:`, and SQLite refuses any other value. Postgres: a `postgres://` URL. | `src/data/sqlite/client.ts`, `src/data/pg/client.ts`, `drizzle.config.ts`, `src/data/migrate.ts`, `src/backup/schedule.ts` |
| `DB_PORT` | `5432` | The host port the Docker Postgres listens on. Set it, and the same port in `DATABASE_URL`, when 5432 is taken. | `docker-compose.yaml` |

## Check it works

```sh
bun run db:status
```

On a migrated SQLite database it prints one line per migration, such as
`applied 0000_init (when 1793971676044)`, and exits 0. Exit 1 means a line reads `skipped` or
`unknown`, and the [troubleshooting](#troubleshooting) section says what to do.

## Turn it off

The database cannot be turned off. To leave Postgres and return to SQLite:

1. Stop the service, and take a backup first with `bun run backup`, since the two databases
   are separate and no command copies rows between them.
2. In `package.json`, set `"#db": "./src/data/sqlite/index.ts"`.
3. In `.env`, set `DATABASE_URL` to `file:./data/app.db`, or remove the line. A `postgres://`
   URL left in place makes the SQLite client refuse to start.
4. Run `bun run db:migrate`, then `bun run db:status`.

To stop the Postgres container, run `bun run db:down`. It keeps the volume, so the data is still
there the next time `bun run db:up` starts it.

Stop the service before you copy `data/app.db` by hand. SQLite runs in WAL mode, so recent
writes can sit in a `-wal` file beside it, and a copy of the main file alone can miss them.

Foreign keys are not enforced on SQLite. Its connection never turns `PRAGMA foreign_keys` on, so
a key that Postgres checks on a write or a delete is not checked there. The Known limitations
section of `.claude/skills/db/actions/add.md` says what an implementor does about it.

## Troubleshooting

Each message is quoted as the code prints it. The failure lines carry a driver code rather than
the driver's own message, because a message can repeat a statement or a URL, so look up the
code in the log line.

A `DATABASE_URL` that does not fit the active dialect stops the start:

```text
DATABASE_URL must be `file:<path>` or `:memory:` for SQLite, or be unset to use ./data/app.db.
```

Remove the Postgres URL, or point `#db` back to SQLite. The other way round, with `#db` on
Postgres and no URL, the start stops with:

```text
DATABASE_URL is not set. Set it in .env (the Postgres line in .env.example), or export it, before opening the database.
```

A migration that fails logs `migration failed` with `"code":"SQLITE_ERROR"`, and it applies
nothing, because each batch runs in one transaction. The file stays `pending`, so fix its SQL
and run `bun run db:migrate` again.

`bun run db:status` exits 1 when a line reads `skipped` or `unknown`. Both are migration
problems that the migrator does not report, and they are recovered step by step in
`.claude/skills/db/reference/migration-recovery.md`. The same reference covers a migrate that
says `database already up to date` while the app reads a column that is not there.

A status run that cannot read the database logs `migration status failed` with a code. The
database URL or the server is the first thing to check.

A seed file named off the pattern stops the seed run:

```text
seed file <name> is not named <NN>-<name>.ts
```

Rename it to match. A seed that throws logs `seed <name> failed`, and the seeds before it
stay committed.

When `bun run db:up` cannot bind 5432, something else holds the port. Set `DB_PORT` and the
same port in `DATABASE_URL`, as the Postgres steps above say.

### The db skill's references

The `db` skill in `.claude/skills/db/` does the database work that this page only describes.
Call its actions by name:

- `/db add <table>` writes a table in both dialects, its exports and a migration for each.
  Its steps are in `.claude/skills/db/actions/add.md`.
- `/db update <table>` adds a column or constraint the stored rows need, as three migrations.
  Its steps are in `.claude/skills/db/actions/update.md`.
- `/db migrate` creates the pending migration for the active dialect and applies it. Its steps
  are in `.claude/skills/db/actions/migrate.md`.

Its references hold the rest. `.claude/skills/db/reference/dialects.md` is the checklist for
switching the active dialect. `.claude/skills/db/reference/data-changes.md` holds the backfill
and seed patterns. `.claude/skills/db/reference/migration-recovery.md` is the flow for a
migration that did not run and for a file that changed after it ran.
