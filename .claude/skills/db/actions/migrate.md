# /db migrate

Generates any pending migration, shows its SQL, applies it, and reports the count the migrator
logged. It works on the active dialect, whose folder is `drizzle/sqlite/` unless `#db` in
`package.json` names the Postgres folder.

1. **Generate what is pending.** Run `bun run db:generate`. It writes the active dialect's
   folder, and prints `No schema changes, nothing to migrate` when the schema matches the last
   snapshot. When the other dialect's schema changed too, generate its migration with the
   drizzle-kit command in `.claude/skills/db/actions/add.md`, step 4.

2. **Show the SQL.** Print each new file, `drizzle/<dialect>/<NNNN>_<name>.sql`, and read it
   before you apply it. A new `CREATE TABLE`, an `ALTER TABLE ... ADD` or a backfill is routine.
   A table rebuild, or any `DROP`, moves rows, so read it closely before you go on.

3. **Check the status before.** Run `bun run db:status`, which logs under `Db:status` (scope
   `status`). Every line must read `applied`, or
   `pending` for a migration this change adds. A `skipped` or `unknown` line exits 1: stop, and
   read `.claude/skills/db/reference/migration-recovery.md` before you migrate. drizzle-orm 0.45
   skips a `skipped` migration without an error
   ([drizzle-team/drizzle-orm#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769)).
   Drizzle v1 fixes that skip, and this check goes away with drizzle v1.

4. **Apply it.** Run `bun run db:migrate`, then `bun run db:status` again. Every line must read
   `applied`; a `skipped` line left after the migrate is the skip above, so read the recovery
   reference. The migrate script logs one line under `Db:migrate` (scope `migrate`, step
   `apply`):
   - `"applied":N,"msg":"applied migrations"` when N migrations ran. Report N.
   - `"applied":0,"msg":"database already up to date"` when none did.

   A failure logs `migration failed` with a `code` and exits 1. Report the code. The log does not
   carry the statement, and it should not.

   `bun run db:seed` logs under `Db:seed` (scope `seed`): a `run` step line with the seed files
   it ran, or a `code` line on a failure. It is not part of the migrate step.

## What the migrator does

- Pending migrations of the active dialect run in one transaction. SQLite wraps the batch in
  `BEGIN` and `COMMIT`, and Postgres runs it in one `session.transaction`, both in drizzle-orm's
  migrator. A failure in any file rolls back the whole batch, not only that file.
- A migration runs only when its journal `when` stamp is later than the newest migration already
  applied. A migration that arrives with an older stamp is skipped without an error, and the
  `applied` count leaves it out. That is drizzle-orm 0.45's bug, reported as
  [drizzle-team/drizzle-orm#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769) and
  fixed only on the drizzle v1 line. Until drizzle v1, `bun run db:status` reports the skip, and
  that check goes away with drizzle v1. When a migration you expected is missing from the count,
  read its `when` in `drizzle/<dialect>/meta/_journal.json` against the newest one.
- An applied migration does not run again, so a fix to an applied file does nothing. Fix it in
  a new migration.

## SQLite limits

- SQLite has no `ALTER COLUMN`. A change to a column's type, nullability, default or constraint
  is a table rebuild, and drizzle-kit writes it as: `PRAGMA foreign_keys=OFF`, then
  `CREATE TABLE __new_<table>` with the new definition, `INSERT ... SELECT` to copy the rows by
  column name, `DROP TABLE <table>`, `ALTER TABLE __new_<table> RENAME TO <table>`, and
  `PRAGMA foreign_keys=ON`. The generated file shows every one of these statements, so read them.
- SQLite refuses `ADD` of a `NOT NULL` column with no default to a table that has rows
  (`Cannot add a NOT NULL column with default value NULL`). That is why
  `.claude/skills/db/actions/update.md` adds the column loose first. drizzle-kit generates such
  a column as a plain `ALTER TABLE ... ADD ... NOT NULL` without a warning, and the migrator
  logs the refusal only as `"code":"SQLITE_ERROR","msg":"migration failed"`. The message itself
  is not in the log. An empty table accepts the same statement, so a run on a new database does
  not show the fault.
