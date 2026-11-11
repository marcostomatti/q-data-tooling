# Backup

This page covers the backups: what each dialect's dump holds, the schedule that writes them while
the service runs, `bun run backup` for a dump on demand, the `pg_dump` settings for Postgres,
where the files go, and how to restore one. [Database](database.md) covers the two dialects.

## What it is and when to turn it on

A backup is one file with a copy of every row the service stores. It is written while the service
keeps running. Backups are on by default: `bun run serve` starts a schedule that writes one when
none exists, then checks every hour and writes a new one when the newest is `intervalDays` old.

Each dialect writes a different kind of file:

- **SQLite** writes a copy made by SQLite's own `VACUUM INTO`. It is a plain SQLite database, and
  it is consistent even while a write is in progress. A plain copy of `data/app.db` can miss the
  writes still held in its `-wal` file, so do not copy that file by hand. It needs no binary.
- **Postgres** writes a `pg_dump` archive in custom format, of the whole database that
  `DATABASE_URL` names. It needs a `pg_dump` binary, which [Postgres](#postgres) below covers.

Both files hold all of the service's data, including the auth tables and the `backup` row of
`app_config`. They do not hold `.env`, and they do not hold the Open Notebook's own store, which
is a separate service. A dump is therefore the personal data this project keeps out of git, and
the folder it lands in is gitignored for that reason.

## Setup from zero

### SQLite

Nothing beyond [setup](setup.md) is needed. Migrate first, so that the schedule can read its
settings from `app_config`:

```sh
bun run db:migrate
bun run backup
```

The first command creates `data/app.db` and its tables. The second writes the first dump.

### Postgres

1. Switch to Postgres as [database](database.md#postgres) describes, then run `bun run db:up` and
   `bun run db:migrate`.
2. Give the backup a `pg_dump` at least as new as the server. The Docker database is Postgres 16,
   and an older `pg_dump` refuses it. Either install a matching client, or run the container's
   own copy through `scripts/pg_dump-docker.sh`. To use the script, set `PG_DUMP_BIN` to its path.
   The script ignores the host and port in `DATABASE_URL`, so use it only while `DATABASE_URL`
   names the Docker database. Against any other server it still dumps the container's database.
3. Write a dump with the script in place:

   ```sh
   PG_DUMP_BIN=scripts/pg_dump-docker.sh bun run backup
   ```

   Run it from the root of the clone, because a relative `PG_DUMP_BIN` is read from the directory
   `bun run` starts in. To keep it set in every run, uncomment the `PG_DUMP_BIN` line in `.env`.

## Configuration

There are two kinds of setting. The variables are read from `.env` or the environment, and the
schedule is a row of `app_config`, read again at every check.

These are the backup rows of the [configuration table](setup.md#configuration), with the same
meaning:

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `DATABASE_URL` | unset, `./data/app.db` | The database to dump. SQLite: `file:<path>`, and unset means the default file. Postgres: a `postgres://` URL, which is a credential and is never logged. | `src/backup/schedule.ts`, `src/backup/pg-dump.ts` |
| `PG_DUMP_BIN` | unset, `pg_dump` from `PATH` | The `pg_dump` the Postgres backup runs, read at each dump. `scripts/pg_dump-docker.sh` runs the container's copy. | `src/backup/pg-dump.ts` |
| `PATH` | set by your shell | Searched for `pg_dump` when `PG_DUMP_BIN` is unset. The backup gives `pg_dump` this and nothing else from your environment. | `src/backup/pg-dump.ts` |

The schedule's settings are the `backup` row of `app_config`, with three fields. Its default is
`{ "enabled": true, "keep": 1, "intervalDays": 14 }`:

| Field | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | `false` stops the schedule. A `serve` started with it `false` starts no schedule, and a running one writes nothing at its next check. `bun run backup` still runs. |
| `keep` | `1` | How many of the newest backups stay. The rest are removed after a new dump succeeds. Between 1 and 1000. |
| `intervalDays` | `14` | Days between scheduled backups. Between 1 and 1000. |

Nothing in the app sets these, so store all three when you change one. A stored value that does
not fit reads as its default, and the log line `unusable backup settings in app_config` names the
field. To keep three dumps a week apart, on Postgres:

```sh
docker compose exec db psql -U template-service -d template-service -c "
  INSERT INTO app_config (key, value) VALUES ('backup', '{\"enabled\": true, \"keep\": 3, \"intervalDays\": 7}')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"
```

On SQLite, use the `sqlite3` command-line tool on `data/app.db`, and `unixepoch()` in place of
`now()`:

```sh
sqlite3 data/app.db "
  INSERT INTO app_config (key, value) VALUES ('backup', '{\"enabled\": true, \"keep\": 3, \"intervalDays\": 7}')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = unixepoch();"
```

### The `pg_dump` options

The backup runs `pg_dump` with three arguments and nothing else: `--format=custom`,
`--no-password`, and `--file=` pointing at the dump being written. The connection goes in the
environment, never on the command line, where any process on the machine could read it. It is
split from `DATABASE_URL` into `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` and
`PGSSLMODE` (from the `sslmode` parameter). A `pg_dump` still running after 10 minutes is sent
`SIGTERM`, and `SIGKILL` five seconds later.

Because of `--no-password`, a `pg_dump` never waits at a prompt. A server that needs a password
gets it from the password in `DATABASE_URL`.

## Check it works

```sh
bun run backup
```

On a migrated SQLite database it prints one line, such as
`wrote backup-20261107T001245Z.dump to backups/ (0 older removed)`, and exits 0. The name carries
the UTC time of the dump, `backup-<YYYYMMDD>T<HHMMSS>Z.dump`, so names sort by time. The count in
brackets is how many older dumps `keep` removed.

### Where the files go

Dumps go to `backups/` at the root of the clone, whatever directory you run the command from. The
folder is created with mode `0700`, and each file is `0600`, so only your user can read them.
A dump is written first as `<name>.partial` and renamed once complete, so a file without the
`.partial` suffix is always whole. A `.partial` older than an hour is swept at the start of each
run, and a failed dump leaves nothing that `keep` would count.

### Restoring a backup

Restore into the database the dump came from, or into an empty one. Restoring over a live service
is not safe.

On SQLite:

1. Stop the service.
2. Delete `data/app.db-wal` and `data/app.db-shm` if they exist. They belong to the database you
   are replacing.
3. Copy the dump over `data/app.db`, or over the file `DATABASE_URL` names.
4. Start the service, then run `bun run db:status` to check its migrations.

On Postgres, use a `pg_restore` at least as new as the `pg_dump` that wrote the file. Give the
connection as `PG*` variables and let it prompt for the password, never a URL on the command line,
where `ps` shows it to every user:

```sh
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=template-service PGDATABASE=template-service \
  pg_restore --no-owner --dbname="$PGDATABASE" backups/backup-20261107T001245Z.dump
```

`pg_restore` connects only when it has `--dbname`. Into a database that already has tables, add
`--clean --if-exists`, which drops what it finds before it restores.

## Turn it off

To stop the schedule, store `enabled` as `false`, with the SQL in [Configuration](#configuration).
A check that runs after the change writes nothing, and a `serve` started after it starts no
schedule. Nothing restarts. `bun run backup` still writes a dump on demand, whatever the stored
settings say.

To stop the schedule without touching the database, stop `bun run serve`. Its schedule ends with
it.

## Troubleshooting

Each message is quoted as the code prints it. A `bun run backup` that fails prints the message
after `backup failed:` on stderr and exits 1. The schedule logs the same text as `backup failed`,
in a `reason` field.

A Postgres backup with no URL stops before any dump:

```text
backup failed: DATABASE_URL is not set. Set it in .env (the Postgres line in .env.example), or export it, before opening the database.
```

Set `DATABASE_URL` as [database](database.md#postgres) describes. A URL that is not a
`postgres://` one fails with:

```text
backup failed: DATABASE_URL is not a usable postgres connection URL
```

A `pg_dump` that is not on `PATH`, or a `PG_DUMP_BIN` path that does not exist, fails with a line
that names the binary and the start error code. With `PG_DUMP_BIN` unset, the name is `pg_dump`:

```text
pg_dump could not be run (unknown): pg_dump could not be started (ENOENT)
```

Fix the path, or install `pg_dump`.

A `pg_dump` that starts and then fails writes its own message after `pg_dump exited with code`.
When that message is a version mismatch, the server is newer than the client. Use
`PG_DUMP_BIN=scripts/pg_dump-docker.sh` as Postgres step 2 says. A `pg_dump` that exits cleanly
without writing a file gives `pg_dump exited cleanly but wrote no file`. A `pg_dump` stopped at the
10-minute limit gives `pg_dump was stopped by SIGTERM` or `pg_dump was stopped by SIGKILL`.

A SQLite database that is not migrated still gets a dump, but the settings cannot be read:

```text
backup settings could not be read; no older backup was removed
```

The dump is written, and no older one is removed, since with no `keep` to go by a removal could
lose data. Run `bun run db:migrate`, and the next run reads the settings.

A `:memory:` database has no file to copy, so the backup refuses it with this message:

```text
an in-memory SQLite database (`:memory:`) cannot be backed up
```

A SQLite file that does not exist is never created by a dump. The backup fails with
`the SQLite database could not be opened`, followed by the driver's code in brackets. Check
`DATABASE_URL`, then run `bun run db:migrate` to create the file.

A scheduled `serve` that logs `backups are off in app_config; no schedule started` is working as
stored. Set `enabled` to `true` to start one at the next `bun run serve`.
