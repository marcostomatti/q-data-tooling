# /db update <table>

Use this when a change to an existing table cannot be satisfied by the rows already stored: a
new `NOT NULL` column, a narrower type, or a new unique constraint. A change the stored rows
satisfy as they are, such as a new nullable column, needs no backfill: generate it and migrate
it as `.claude/skills/db/actions/migrate.md` describes.

The change goes in three steps. Each step is its own migration, and each is applied before the
next is generated.

1. **Add it loose.** In both twin files, `src/data/sqlite/tables/<area>.ts` and
   `src/data/pg/tables/<area>.ts`, add the column without `.notNull()`, or add the unique
   constraint without tightening anything else. Generate both dialects, run the journal test,
   then apply:

   ```sh
   bun run db:generate --name add-<column>
   ./node_modules/.bin/drizzle-kit generate --dialect postgresql --schema ./src/data/pg/tables \
     --out ./drizzle/pg --name add-<column>
   bun test tests/data/journal.test.ts
   bun run db:migrate
   ```

   The journal test fails when an entry's `when` is not later than the one before it, and
   drizzle-orm 0.45 skips such an entry without an error
   ([drizzle-team/drizzle-orm#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769)).
   Drizzle v1 fixes that skip, and this test goes away with drizzle v1. Do not migrate while it
   fails.

   When Postgres is the active dialect, swap the generate lines as
   `.claude/skills/db/actions/add.md`, step 4, describes. A nullable column is one
   `ALTER TABLE ... ADD` statement on SQLite and `ALTER TABLE ... ADD COLUMN` on Postgres, and
   every row that already exists reads NULL in it.

   Do not skip this step by adding the column as `.notNull()` straight away. drizzle-kit
   generates that as a plain `ALTER TABLE ... ADD ... NOT NULL` with no warning, and on a SQLite
   table that has rows `bun run db:migrate` then fails, as
   `.claude/skills/db/actions/migrate.md` describes under "SQLite limits".

2. **Backfill, then check.** Fill the column for the existing rows as a custom migration, one
   per dialect:

   ```sh
   bun run db:generate --custom --name backfill-<column>
   ./node_modules/.bin/drizzle-kit generate --custom --dialect postgresql \
     --schema ./src/data/pg/tables --out ./drizzle/pg --name backfill-<column>
   ```

   Each command writes `drizzle/<dialect>/<NNNN>_backfill-<column>.sql` holding only the header
   line. Write the SQL as `.claude/skills/db/reference/data-changes.md` describes, and read its
   rules before you write anything.

   Run `bun test tests/data/journal.test.ts` after the two generate commands and before the
   migrate, as step 1 does. drizzle-orm 0.45 skips an entry whose `when` is not later than the
   one before it, with no error
   ([drizzle-team/drizzle-orm#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769)).
   Drizzle v1 fixes that skip, and this test goes away with drizzle v1.

   Before you migrate, take the control reading with the check query in that file: `total`
   counts the rows, and `nulls` must equal it. A `nulls` of 0 after the backfill proves nothing
   on a table with no rows, so a `total` of 0 here means there is nothing to backfill, not that
   the check passed. Then run `bun run db:migrate` and take the reading again: `total` must be
   unchanged and `nulls` must be 0. Do not generate step 3 until both hold.

3. **Tighten.** Change the twins to `.notNull()`, the unique constraint, or the narrower type.
   Generate both dialects with the two commands of step 1 and `--name tighten-<column>`, then
   apply them with `.claude/skills/db/actions/migrate.md`. On SQLite this is a table rebuild,
   which the generated SQL shows and that file explains. On Postgres a new `NOT NULL` is one
   `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`. Since both migrations already exist, the
   `bun run db:generate` of its step 1 prints `No schema changes, nothing to migrate`.

   Run `bun test tests/data/journal.test.ts` between the generate and the apply, as step 1 does.
   drizzle-orm 0.45 skips an entry whose `when` is not later than the one before it, with no
   error ([drizzle-team/drizzle-orm#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769)).
   Drizzle v1 fixes that skip, and this test goes away with drizzle v1.

## Checks before the tighten

- Each step is its own migration. The check in step 2 reads the data after the backfill has
  been applied, so it has to run between the two migrations. Generating step 3 before the check
  passes would tighten a column the backfill has not finished.
- For a new unique constraint, look for duplicates first, and expect no rows:

  ```sql
  SELECT <column>, count(*) FROM <table> GROUP BY <column> HAVING count(*) > 1;
  ```

- For a narrower type, convert the stored values in the backfill, so that step 3 changes only
  the type and not the values.
