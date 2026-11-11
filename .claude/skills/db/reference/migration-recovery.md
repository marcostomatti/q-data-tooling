# Migration recovery

What to do when a migration did not run, or when a migration file changed after it ran. Read this
when `bun run db:status` prints a `skipped` or `unknown` line, or when `bun run db:migrate` reports
`database already up to date` and the app reads a column that is not there.

The cause is in drizzle-orm 0.45. Its migrator reads only the newest `created_at` in
`__drizzle_migrations`, and runs each journal entry whose `when` is later than it. An entry with an
older `when`, such as one a merged branch generated, is never run, and nothing reports it
([drizzle-team/drizzle-orm#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769), fixed
only on the drizzle v1 line). `db:status` is the check that finds it. It goes away with drizzle v1,
which applies migrations by name; until then, this flow stands.

## The flow

```text
db:migrate says up to date, or the app reads a column that is not there
→ take a backup: bun run backup
→ bun run db:status
   → skipped: apply that file's SQL by hand in one transaction,
              insert its (hash, when) row into __drizzle_migrations,
              run db:status again
   → unknown: a file changed after it was applied; restore the file from git,
              then write a new migration for the change
   → pending only: run db:migrate
→ db:status shows every migration applied
```

## 1. Back up

Run `bun run backup` before any write to the database, so that a wrong recovery can be undone.

## 2. Read the status

`bun run db:status` prints one line per migration of the active dialect's folder,
`drizzle/<dialect>/`, then one line per row of `__drizzle_migrations` that matches no file:

```text
applied 0000_init (when 1793971676044)
skipped 0001_orders (when 1793971680000)
unknown row created_at 1793971676044: hash 9f2c... matches no migration file
```

Exit 0 means every line is `applied` or `pending`. Exit 1 means at least one line is `skipped` or
`unknown`. Run it with no `db:migrate` in between, so the lines describe the database as it is.

## 3. A skipped line

`skipped` means the file has not changed and never ran: its `when` is not later than the newest
`created_at` in the table, so drizzle will not run it. Apply it by hand, once:

1. Read `drizzle/<dialect>/<tag>.sql`. If more than one line reads `skipped`, apply them in the
   order the journal lists them.
2. Compute its hash with `sha256sum drizzle/<dialect>/<tag>.sql`, the sha256 hex of the file as it
   is. Do not normalise line endings or strip a BOM first, or the hash will not match the one
   drizzle computes.
3. In one transaction, run the file's statements, unchanged, then insert its row. On SQLite:

   ```sql
   BEGIN;
   -- the statements of drizzle/sqlite/<tag>.sql, unchanged
   INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES ('<sha256 hex>', <when>);
   COMMIT;
   ```

   On Postgres, the table is `drizzle.__drizzle_migrations` and `created_at` is a bigint, so the
   insert is:

   ```sql
   INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
     VALUES ('<sha256 hex>', <when>);
   ```

   Leave `id` out, as the migrator does; its default fills it.
4. Run `bun run db:status` again. Every line must read `applied` before you go on.

Apply only the files `db:status` lists as `skipped`. A file it lists as `applied` already ran, and
running its statements again repeats them. The hand insert leaves the journal and the snapshot
chain alone; re-stamping a `when` in `drizzle/<dialect>/meta/_journal.json` would break both.

## 4. An unknown line

`unknown` means the table holds a hash that no file has now, so a file changed after it was
applied. Look for a `skipped` line whose `when` equals the unknown row's `created_at`:

- **Such a `skipped` line exists.** That file was edited after it ran: the row stores the hash of
  its original text, and the edit moved the file out of the migrator's reach. Restore the file from
  git with `git restore drizzle/<dialect>/<tag>.sql`, and do not apply it by hand. Once restored,
  its hash matches the row and `db:status` reads it as `applied`. `git restore` discards uncommitted
  edits to the file, so copy the edited text aside first if you need it.
- **No such `skipped` line.** The file was edited or removed after it ran. Restore it from git the
  same way. Then make the change in a new migration: `bun run db:generate` after the schema change,
  as `.claude/skills/db/actions/migrate.md` describes. An applied file is never run again, so a fix
  made to it does nothing.

Run `bun run db:status` after the restore. Every line must read `applied` or `pending`.

## 5. A pending line

`pending` means the next migrate will run it. Run `bun run db:migrate`, then `bun run db:status`
again, and read the count the migrator logged, as `.claude/skills/db/actions/migrate.md` describes.

## 6. A migration that fails

A `migration failed` log with `"code":"SQLITE_ERROR"` applied nothing. The migrator runs the batch
in one transaction, so a failed batch rolls back in full, and the failing file stays `pending`.
The log does not carry the statement, so read the file's SQL, fix the cause, and run
`bun run db:migrate` again. Because the file is still `pending`, editing it before it applies is
allowed.
