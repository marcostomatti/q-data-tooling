---
name: db
description: Use when adding a table, adding a new table, changing an existing table, writing a
  migration, running the migrations, backfilling existing rows or seeding the database. Trigger
  words include "add a table", "new table", "migration", "migrate", "backfill" and "seed".
---

# /db

The router for database work in this template. It has three actions and three references. Read
only the action file you were called with, and open a reference only when an action or this
router points to it.

| Call | Read |
| --- | --- |
| `/db add <table>` | `.claude/skills/db/actions/add.md` (see its Known limitations section) |
| `/db update <table>` | `.claude/skills/db/actions/update.md` |
| `/db migrate` | `.claude/skills/db/actions/migrate.md` |

Backfill and seed patterns on SQLite and Postgres: `.claude/skills/db/reference/data-changes.md`.

Switching the active dialect to Postgres, or back to SQLite:
`.claude/skills/db/reference/dialects.md`.

A migration that did not run, or a file that changed after it ran, is recovered by the flow in
`.claude/skills/db/reference/migration-recovery.md`, which `bun run db:status` points to.

## Where the pieces live

- A table is `src/data/sqlite/tables/<area>.ts` and its twin `src/data/pg/tables/<area>.ts`, one
  file per dialect. `src/data/sqlite/tables/config.ts` holds `app_config` as the worked example.
- The index of each dialect (`src/data/sqlite/index.ts` and `src/data/pg/index.ts`) re-exports
  its tables, and `src/data/active.ts` re-exports them. Repositories import the schema from
  `src/data/active.ts`, not from a dialect folder.
- Migrations are generated into `drizzle/sqlite/` and `drizzle/pg/`. `bun run db:generate` writes
  only the active dialect's folder, and `drizzle.config.ts` reads the active dialect from the
  `#db` entry of `package.json`.
- `bun run db:migrate` applies the active dialect's migrations to the database `DATABASE_URL`
  names.
- `bun run db:seed` runs the seed files named `src/data/seeds/<NN>-<name>.ts`, in file-name
  order. The template ships none.
