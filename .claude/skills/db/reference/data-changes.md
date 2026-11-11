# Data changes: backfill and seed patterns

The patterns for changing the rows of a database, on SQLite and on Postgres.
`.claude/skills/db/actions/update.md` points here for a backfill, and
`.claude/skills/db/actions/add.md`, step 7, for a seed.

## Backfill: a custom migration

`bun run db:generate --custom --name backfill-<column>` writes an empty migration for the active
dialect. For the other dialect, run drizzle-kit with `--custom` and that dialect's flags, as in
`.claude/skills/db/actions/add.md`, step 4. Every file it writes opens with the same header line:

```sql
-- Custom SQL migration file, put your code below! --
```

Two rules govern the file:

1. **Write below the header, on new lines.** The header ends in `--`, so SQL typed on that line
   is inside the comment. It never runs, and the migration completes without an error. Measured
   on SQLite: a backfill typed on the header line left every row NULL, and nothing failed. The
   generated file ends on that header with no newline after it, on both dialects, so text
   appended to the file (`>>`) lands on the header line. Write the whole file, header line
   first, rather than appending to it.
2. **End the file on a statement, not on a comment or a bare breakpoint.** A
   `--> statement-breakpoint` line followed only by a comment or blank lines makes an empty
   statement. `db:migrate` then fails with `Failed to run the query` and applies none of the
   batch. Measured on SQLite. A `--` comment after a statement on the same line did not stop
   that statement; the failing shape is a breakpoint with nothing after it.

Separate statements with `--> statement-breakpoint`, as drizzle-kit writes them.

The backfill itself, on SQLite (drizzle-kit quotes names with backticks):

```sql
-- Custom SQL migration file, put your code below! --
UPDATE `<table>` SET `<column>` = <value> WHERE `<column>` IS NULL;
```

On Postgres, quote names with double quotes:

```sql
-- Custom SQL migration file, put your code below! --
UPDATE "<table>" SET "<column>" = <value> WHERE "<column>" IS NULL;
```

`<value>` can be an expression on the same row. A JSON column is changed with that dialect's
JSON functions.

Check the effect after `bun run db:migrate`, rather than assuming it ran. The query reads two
counts: `total`, the rows in the table, and `nulls`, the rows the backfill should have filled.
Run it once before the backfill migration as the control, where `nulls` must equal `total`,
and once after it, where `nulls` must be 0 and `total` must be unchanged. A `nulls` of 0 alone
is no pass: an empty table reads 0 too.

On SQLite, against the file `DATABASE_URL` names (the default file when it is unset):

```sh
bun -e "
  import { Database } from 'bun:sqlite'
  const url = process.env.DATABASE_URL || 'file:./data/app.db'
  const db = new Database(url.replace(/^file:/, ''))
  console.log(db.query('select count(*) as total, count(*) filter (where <column> is null) as nulls from <table>').get())
"
```

On Postgres:

```sh
psql "$DATABASE_URL" -c 'select count(*) as total, count(*) filter (where "<column>" is null) as nulls from "<table>"'
```

A `nulls` above 0 after the backfill means it missed rows or did not run. Fix it in a new
migration. An applied migration is not run again, so editing it changes nothing.

The SQLite database runs in WAL mode (`src/data/sqlite/client.ts`), so recent writes can sit in
the `-wal` file beside it. A copy of the database file alone, taken to try a migration and roll
it back, can be missing those rows. Measured: a copy restored that way read `total` 0.

## Seeds

`bun run db:seed` runs `src/data/seed.ts`. It loads each seed file named
`src/data/seeds/<NN>-<name>.ts` in file-name order. A name is two digits, a dash and a
lower-case kebab name. A file in that folder with any other name stops the run before any seed
runs. Each file's `seed` runs inside its own `transact`, so a seed that throws rolls back its own
writes. The seeds before it stay committed, and the run stops and names the file.

The runner records nothing, so every run runs every seed again. A seed is therefore idempotent
by construction: it inserts on its natural key with `onConflictDoNothing()`. A seed imports from
`src/data/active.ts`, so one file serves both dialects and needs no twin.

This example, run through the runner twice on a migrated SQLite database, leaves one row:

```ts
import { appConfig } from '../active.ts'
import type { Db } from '../repositories/db.ts'

export async function seed(db: Db): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: 'example', value: { enabled: true } })
    .onConflictDoNothing()
}
```

- Leave `updatedAt` out, so the column default applies: `NOW_SECONDS` on SQLite and `now()` on
  Postgres.
- Do not call `db.transaction`. The runner has already opened `transact` around the seed.
