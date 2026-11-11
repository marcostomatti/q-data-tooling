# /db add <table>

Adds a table to both dialects, so the SQLite build and the Postgres build keep the same schema.
The active dialect is the one `#db` in `package.json` names, `src/data/sqlite/index.ts` by
default. Run every step for both dialects, whichever is active.

## Steps

1. **Write the table twice.** Put it in `<area>`, the file for the area it belongs to (such as
   `config` or `auth`), once per dialect: `src/data/sqlite/tables/<area>.ts` and
   `src/data/pg/tables/<area>.ts`. Keep the table name, the key and the column names the same in
   both, and use each dialect's column builders. The worked example is `app_config`:

   ```ts
   // src/data/sqlite/tables/config.ts
   export const appConfig = sqliteTable('app_config', {
     key: text().primaryKey(),
     value: text({ mode: 'json' }).notNull(),
     updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(NOW_SECONDS),
   })
   ```

   ```ts
   // src/data/pg/tables/config.ts
   export const appConfig = pgTable('app_config', {
     key: text().primaryKey(),
     value: jsonb().notNull(),
     updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
   })
   ```

   Timestamps follow the dialect. On SQLite, `NOW_SECONDS` is exported by
   `src/data/sqlite/tables/auth.ts`, and `src/data/sqlite/tables/config.ts` imports it from
   there. Use `integer(..., { mode: 'timestamp' })` with `.default(NOW_SECONDS)`. Do not use
   `current_timestamp`: it reads back as an invalid date. On Postgres, use
   `timestamp(..., { withTimezone: true })` with `.defaultNow()`. For a generated id, copy
   `apiToken` in `src/data/sqlite/tables/auth.ts` and `src/data/pg/tables/auth.ts`.

   Name the export the camelCase of the table name, as `appConfig` is `app_config`. A second
   table in the same area goes in the same file. A key to another table is
   `.references(() => parent.id, { onDelete: 'cascade' })` on both dialects. SQLite does not
   enforce it; see Known limitations below.

2. **Export it.** Name the table in `src/data/sqlite/index.ts` and in `src/data/pg/index.ts`,
   then in the list in `src/data/active.ts`. A table missing from `src/data/active.ts` is not
   reachable from the repositories. A repository for one route's resource goes in
   `src/routes/<plural>/repository.ts`, which `/be create-route` writes. One that several areas
   share goes in `src/data/repositories/<name>.ts`. Either kind takes a `Db` from
   `src/data/repositories/db.ts`. A write that spans several statements goes through
   `transact(db, body)`, never `db.transaction`. A repository throws and logs only what it alone
   can see, such as a unique key that clashes. It logs that as a step on the `log` its caller
   passes, never on a logger of its own, so the flow above it does not log the same failure twice.

3. **Pin the table list.** Four tests pin it, and each fails until it names the new table:
   - `EXPECTED_TABLES` in `tests/data/schema-tables.test.ts` holds the table name. Its SQLite half
     compares the list with the tables `src/data/sqlite/index.ts` exports, so a table left out,
     or listed but not exported, fails the run. Its Postgres half runs only when `TEST_PG_URL` is
     set.
   - `tests/data/sqlite/schema.test.ts` pins every name `src/data/sqlite/index.ts` exports, in
     its test "the index exports its dialect, the client, the dependency and the tables".
     Add the export's name, in sorted order.
   - `tests/data/pg/index.test.ts` pins the same sorted list for `src/data/pg/index.ts`, in its
     test "exports the same names as the SQLite one". Add it there too.
   - `tests/support/sqlite-db.test.ts` pins the table list, and the count of migrations in
     `drizzle/sqlite/`, in its test "opens :memory: with the migrated tables and the migration
     record". Add the table name in sorted order. The count rises by one for each migration this
     change adds, so that expectation moves too.

4. **Generate both dialects' migrations.** `bun run db:generate` writes only the active
   dialect's folder, `drizzle/sqlite/` by default. For the other dialect, call drizzle-kit with
   its flags, which leave `package.json` alone:

   ```sh
   bun run db:generate --name add-<table>
   ./node_modules/.bin/drizzle-kit generate --dialect postgresql --schema ./src/data/pg/tables \
     --out ./drizzle/pg --name add-<table>
   ```

   When Postgres is the active dialect, swap the two: the `--dialect sqlite` line writes
   `drizzle/sqlite/`. Each run writes `drizzle/<dialect>/<NNNN>_add-<table>.sql` and a journal
   entry.

   Then run `bun test tests/data/journal.test.ts`, before any migrate. It fails when an entry's
   `when` is not later than the one before it, and drizzle-orm 0.45 skips such an entry without an
   error ([drizzle-team/drizzle-orm#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769)).
   Drizzle v1 fixes that skip, and this test goes away with drizzle v1. Do not migrate while it
   fails.

5. **Read the SQL back.** Open each new file and check that it names only the new table: one
   `CREATE TABLE` for `<table>`, with no rebuild of another table. A key to another table is the
   one expected extra: SQLite writes it inside the `CREATE TABLE` as `FOREIGN KEY (...)`, and
   Postgres adds it after, as `ALTER TABLE "<table>" ADD CONSTRAINT ... FOREIGN KEY`. Any other
   statement, an `ALTER` of another table above all, means the schema has drifted from the last
   snapshot. Stop and read the diff before you migrate.

6. **Apply it.** Run `bun run db:migrate`. It logs `"applied":N,"msg":"applied migrations"`, with
   N the number of migrations it ran: `"applied":1` on a database that was at the previous
   migration, every migration on a new database file, and
   `"applied":0,"msg":"database already up to date"` when the database was already up to
   date. The Postgres side is applied when that dialect is active.
   `tests/data/schema-tables.test.ts` checks it against a scratch database when `TEST_PG_URL`
   is set.

7. **Offer a seed file.** Ask whether the table needs starting rows. If it does, write
   `src/data/seeds/<NN>-<name>.ts` as `.claude/skills/db/reference/data-changes.md` describes.
   If it does not, say so.

8. **Document it.** Give each table and each column whose name does not say it all a TSDoc block,
   `/** ... */` before it, in both dialects' files. `docs/documentation.md` holds the rules.

9. **Verify.** Run
   `bun run typecheck && bun run typecheck:pg && bun run lint && bun test tests/data`. The
   Postgres tests in `tests/data` are gated by `describePg` in `tests/support/pg-gate.ts`. Without
   `TEST_PG_URL` they show as skipped, which is not a pass.

## Known limitations

SQLite does not enforce foreign keys, and the template leaves that to the implementor rather than
wrapping SQLite to behave like Postgres.

- SQLite runs with foreign keys off. `getDb()` and `openMigratedMemoryDb()` never turn
  `PRAGMA foreign_keys` on, so a key's `onDelete: 'cascade'` and the parent-exists check act on
  Postgres only.
- On SQLite a delete removes no related rows. The implementor handles it one of two ways: a helper
  in the route's repository that deletes the children and then the parent in one
  `transact(db, body)`, or an independent delete query that the flow calls first.
- A child write on SQLite does not check that its parent exists. The flow checks it and throws
  `NotFoundError` for a missing parent.
