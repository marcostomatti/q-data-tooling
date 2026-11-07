# Setup

This page takes a fresh clone to a running service, then covers the configuration, every
`package.json` script, the gates, the ESLint hook and the privacy check. The default is SQLite:
no Docker and no server. Postgres, sign-in and the other add-ons are not set up here.

## Prerequisites

- **Bun**, version 1.3.14, which is the version CI installs. The project's own commands run
  through `bun`, which also reads `.env` for you.
- **Git**, to clone, and for the privacy check, which reads the files git tracks.
- **Docker**, only for Postgres (`bun run db:up`) and the optional Open Notebook stack. SQLite
  needs neither.
- **gitleaks**, only for the privacy check and the export, which both run it. Without it, the
  check runs with `--no-gitleaks` (see [the gates](#the-gates)). The export refuses to run
  without it.

## Clone and install

```sh
git clone <repository-url> template-service
cd template-service
bun install --frozen-lockfile
```

`--frozen-lockfile` installs exactly what `bun.lock` holds, as CI does. It fails rather than
changing `bun.lock`.

## Create `.env`

```sh
cp .env.example .env
```

Every line of `.env.example` is commented out, so the copy sets nothing and the defaults apply:
SQLite at `./data/app.db`, no sign-in and no notebook tools. One thing is not a default: the
service does not start until `API_KEY` or `AUTH_MODE` is set. The first run below sets
`API_KEY`. The [configuration](#configuration) section lists every variable.

## The first migration

```sh
bun run db:migrate
```

This creates `data/app.db`, and its folder, when they are missing. It then applies the SQLite
migrations in `drizzle/sqlite/`. A second run applies nothing.

To see where the journal stands, run:

```sh
bun run db:status
```

It prints one line per migration and exits 1 when any line is `skipped` or `unknown`, so a
clean database exits 0.

## The first run

Write an API key into `.env`, then start the server:

```sh
bun run setApiKey --burn-after-reading
bun run serve
```

`setApiKey --burn-after-reading` generates the key, which you do not choose, saves it as
`API_KEY` in `.env`, and shows it once. The screen clears after 30 seconds, and `cat .env`
shows the key again.

`bun run serve` listens on port 3000 on every network interface, so keep it off networks you do
not trust. When another program holds 3000, it takes the next free port instead and logs a
warning naming both, and its `started` line gives the `url`: use that port below, or set
`PORT_STRICT=true` to stop instead. From a second terminal:

```sh
curl -s localhost:3000/health
curl -s -H "Authorization: Bearer <the key>" localhost:3000/api/info
```

`/health` answers `ok`. `/api/info` answers the reference route's JSON, and `/api` answers 401
to any request without a good credential.

## The HTTP service

`bun run serve` listens on port 3000 (`PORT` changes it), or on the next free port when that one
is taken. Its routes are the `ROUTES` list in `src/routes/http.ts`, mounted under `/api`: today,
`GET /api/info`.

Every `/api` response uses one envelope: `{ "success": true, "data": ... }`, or on failure
`{ "success": false, "error": { "name": "...", "message": "..." } }`. The names are
`ValidationError` and `BulkItemError` (400), `Unauthorized` (401, one body for every cause),
`Forbidden` (403, a browser write without the CSRF header), `NotFoundError` (404),
`ConflictError` (409) and `InternalError` (500). Bodies the package refuses before this code
(not JSON, or over 1 MB, or over the 1,000-a-minute rate limit) get a plain-text or
`{ "error": "<text>" }` answer instead.

## The web build

```sh
bun run build:web
```

This compiles the web app into `src/web/dist/`, which git ignores. The server checks for that
folder when it starts, so restart `bun run serve` after building. With the folder present, the
service serves the web app at `/` and its other pages as well as the API. Without it, the
service serves the API only and logs `no web bundle found; serving the API only`.

## Configuration

Set a variable in `.env` only when you need it. Bun reads `.env` on every `bun run`, and git
ignores the file. Two notes apply to the whole table:

- The backup schedule is not a variable. It is the `backup` row of the `app_config` table,
  read on every check, with the fields `enabled`, `keep` and `intervalDays`. Its default is
  `{ "enabled": true, "keep": 1, "intervalDays": 14 }`.
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` are not read from your
  environment. The backup takes them from `DATABASE_URL` and passes them to `pg_dump` alone.

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `DATABASE_URL` | unset, `./data/app.db` | SQLite: `file:<path>` or `:memory:`, and SQLite refuses any other value. Postgres: a `postgres://` URL. | `src/data/sqlite/client.ts`, `src/data/pg/client.ts`, `drizzle.config.ts`, `src/data/migrate.ts`, `src/backup/schedule.ts` |
| `DB_PORT` | `5432` | The host port the Docker Postgres listens on. Set it, and the same port in `DATABASE_URL`, when 5432 is taken. | `docker-compose.yaml` |
| `PG_DUMP_BIN` | unset, `pg_dump` from `PATH` | The `pg_dump` the Postgres backup runs, read at each dump. `scripts/pg_dump-docker.sh` runs the container's copy. | `src/backup/pg-dump.ts` |
| `TEST_PG_URL` | unset | A Postgres URL for the tests that need a server. The Postgres suites are skipped when it is unset. Point it at a test database. | `scripts/test-db.ts`, `tests/data/migrate.test.ts` |
| `API_KEY` | unset | The key that opens `/api` for a client. `bun run setApiKey` writes it. With neither `API_KEY` nor `AUTH_MODE`, the service refuses to start. | `src/http/server.ts`, `src/auth/access.ts`, `src/auth/set-api-key.ts` |
| `AUTH_MODE` | unset, no sign-in | `password` or `oidc`, one at a time. Any other value stops the start. | `src/auth/config.ts`, `src/auth/set-password.ts` |
| `AUTH_PASSWORD_HASH` | unset | The scrypt hash of the one password, for `AUTH_MODE=password`. `bun run set-password` writes it. A plain password is refused. | `src/auth/config.ts`, `src/auth/reset-credentials.ts` |
| `AUTH_COOKIE_SECURE` | unset, `false` | `true` marks the session cookie `Secure`, for a service behind an HTTPS proxy. | `src/auth/cookies.ts` |
| `OIDC_ISSUER` | unset, required for `oidc` | The issuer URL of the OpenID Connect provider. | `src/auth/config.ts` |
| `OIDC_CLIENT_ID` | unset, required for `oidc` | The client id registered at the provider. | `src/auth/config.ts` |
| `OIDC_CLIENT_SECRET` | unset | The client secret. Leave it unset for a public client, which proves itself with PKCE alone. | `src/auth/config.ts` |
| `OIDC_REDIRECT_URI` | unset, required for `oidc` | The callback URL registered at the provider, such as `http://localhost:3000/auth/oidc/callback`. | `src/auth/config.ts` |
| `OIDC_ALLOWED_SUBJECT` | unset | The one subject allowed in. Set this or `OIDC_ALLOWED_EMAIL`, or the start is refused. | `src/auth/config.ts` |
| `OIDC_ALLOWED_EMAIL` | unset | The one email allowed in, matched only when the provider marks it verified. | `src/auth/config.ts` |
| `OIDC_SCOPES` | `openid email` | Space-separated scopes. `openid` is added when it is missing. | `src/auth/config.ts` |
| `PORT` | `3000` for `serve`, `8080` for MCP over HTTP | The port `serve` listens on, and the port of the MCP HTTP transport. A whole number from 1 to 65535. A taken port falls back to the next free one unless `PORT_STRICT` is set. | `src/http/server.ts`, the service-mcp package |
| `PORT_STRICT` | unset | `true` stops the start with an error naming the port when it is taken. Unset, a taken port falls back to the next free one with a warning. | the service-express package, the service-mcp package |
| `HEALTH_PORT` | `3001` | The port of the health endpoint the MCP server starts over HTTP. A whole number. `PORT` does not move it. | the service-mcp package |
| `HEALTH_PORT_STRICT` | unset | `true` stops the MCP server when the health port is taken. Unset, it falls back to the next free one with a warning. | the service-mcp package |
| `MCP_TRANSPORT` | unset, stdio | `stdio` or unset for stdio. Only the exact value `http` opts in to HTTP. Any other value exits 1 at start. | `src/mcp/transport.ts`, `src/mcp/server.ts` |
| `LOG_LEVEL` | `info` | The lowest level written: `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. | the service-logger package |
| `LOG_FORMAT` | unset | `terminal` for one readable line per record, `json` for pino's JSON line. Unset picks `terminal` when the output is a terminal and `json` when it is not. | the service-logger package |
| `LOG_REDACT` | unset | A comma-separated list of log fields to redact. | the service-logger package |
| `NODE_ENV` | unset | `test` makes `serve` bind a port the OS picks when neither the port option nor `PORT` names one, and start no backup schedule unless one is passed in. | `src/http/server.ts`, the service-express package |
| `OPEN_NOTEBOOK_URL` | unset, notebook tools off | The notebook's address, `http://` or `https://`, with no user or password in it. When the notebook answers at start, eight `notebook_*` tools are added. | `src/notebook/config.ts`, `src/notebook/startup.ts` |
| `OPEN_NOTEBOOK_API_KEY` | unset | The notebook's password, sent to it as a bearer token. Unset for a notebook with no password. | `src/notebook/config.ts`, `docker-compose.notebook.yaml` |
| `OPEN_NOTEBOOK_ENCRYPTION_KEY` | `change-me-template-service` | Compose only. The key that encrypts the provider keys the notebook stores. Set your own. | `docker-compose.notebook.yaml` |
| `OPEN_NOTEBOOK_UI_PORT` | `8502` | Compose only. The host port of the notebook's web UI. | `docker-compose.notebook.yaml` |
| `OPEN_NOTEBOOK_API_PORT` | `5055` | Compose only. The host port of the notebook's REST API. | `docker-compose.notebook.yaml` |
| `SURREAL_USER` | `root` | Compose only. The user of the SurrealDB database the notebook stores into. | `docker-compose.notebook.yaml` |
| `SURREAL_PASSWORD` | `root` | Compose only. Its password. Change it before storing anything in the notebook. | `docker-compose.notebook.yaml` |
| `SURREAL_PORT` | `8000` | Compose only. The host port of SurrealDB, for local debugging. | `docker-compose.notebook.yaml` |
| `PATH` | set by your shell | Searched for `pg_dump`, when `PG_DUMP_BIN` is unset, and for gitleaks. The backup gives `pg_dump` this and nothing else from your environment. | `src/backup/pg-dump.ts`, `scripts/privacy-check.ts` |
| `PRIVACY_DENYLIST` | unset | The denylist file the privacy check and the export read. Unset, the check runs without one, and the export refuses to run. | `scripts/privacy-check.ts`, `scripts/public-export.ts`, `scripts/privacy-history.sh` |

## Commands

Every script in `package.json`, in the order the file lists them. Run one with `bun run <name>`.

| Script | Runs | What it does |
| --- | --- | --- |
| `db:up` | `docker compose up -d --wait` | Starts the Postgres container and waits until it answers. Postgres only. |
| `db:down` | `docker compose down` | Stops the Postgres container. Its data stays in the volume. |
| `db:generate` | `drizzle-kit generate` | Writes the migration for the active dialect's schema into `drizzle/<dialect>/`. |
| `db:migrate` | `bun src/data/migrate.ts` | Applies the active dialect's pending migrations to `DATABASE_URL`. |
| `db:status` | `bun src/data/migration-status.ts` | Compares the migration files with the journal rows. Exits 1 on a skipped or unknown one. |
| `db:seed` | `bun src/data/seed.ts` | Runs the seed files in name order, one transaction each. The template ships none. |
| `setApiKey` | `bun src/auth/set-api-key.ts` | Generates `API_KEY`. With `--burn-after-reading`, saves it to `.env` and shows it once. |
| `mcp` | `bun src/mcp/server.ts` | Starts the MCP server: stdio by default, HTTP when `MCP_TRANSPORT=http`. |
| `serve` | `bun src/http/server.ts` | Starts the HTTP service on `PORT`, default 3000, with the web app when it is built. |
| `backup` | `bun src/backup/schedule.ts --once` | Writes one backup into `backups/` and removes the older ones beyond `keep`. |
| `set-password` | `bun src/auth/set-password.ts` | Asks for the password twice and writes its hash to `AUTH_PASSWORD_HASH` in `.env`. |
| `reset-credentials` | `bun src/auth/reset-credentials.ts` | Signs out every browser, deletes every API token and removes `AUTH_PASSWORD_HASH`. |
| `build:web` | `bun scripts/build-web.ts` | Builds the web app into `src/web/dist/`. |
| `typecheck` | `tsc --noEmit -p .` | Type-checks the active dialect. |
| `typecheck:pg` | `tsc --noEmit -p tsconfig.pg.json` | Type-checks the Postgres dialect, whichever one is active. |
| `test:integration` | `bun test tests/integration tests/contract` | Runs the integration and contract tests. |
| `test:db` | `bun scripts/test-db.ts` | Runs the database suites that fit the active dialect, one line per suite. |
| `lint` | `eslint .` | Lints the tree, including the Markdown under `docs/`. |
| `lint:fix` | `eslint . --fix` | Applies ESLint's autofixes across the tree. Read the diff afterwards (see [the hook](#the-eslint---fix-hook)). |
| `privacy` | `bun scripts/privacy-check.ts .` | Scans the tracked files for private data (see [the privacy check](#the-privacy-check)). |

## The gates

Run these in this order. Each one reads the tree as it stands.

1. `bun run lint`
2. `bun run typecheck`
3. `bun run typecheck:pg`
4. `bun test`
5. `bun run privacy`

`bun test` needs no server. Its Postgres tests run only when `TEST_PG_URL` names one.

`bun run privacy` needs gitleaks on `PATH`. Without it, run the check with its gitleaks step
turned off:

```sh
bun run privacy -- --no-gitleaks
```

Its last line then reads `gitleaks did not run`, so a scan without gitleaks never reads as a
whole one. Run `bun run lint:fix` before the gates to sweep what the hook left.

The workflows in `.github/workflows/` run the same checks. `ci.yml` runs the first four gates,
and `privacy.yml` runs the privacy check with gitleaks, reading its denylist from a repository
secret that it writes outside the checkout.

## The ESLint `--fix` hook

`.claude/settings.json` registers a `PostToolUse` hook for `Edit`, `Write` and `MultiEdit`. After
each of them, `.claude/hooks/eslint-fix.ts` runs `eslint --fix` on that one file. The hook fixes
what ESLint can repair alone, such as semicolons, a line break before a chained call and import
order. It never blocks an edit and prints nothing. An error it cannot repair stays in the file
for `bun run lint` to report.

- It acts only on the file types ESLint reads: code, JSON and Markdown.
- It reads the project root from `CLAUDE_PROJECT_DIR`, which Claude Code sets, and calls `bunx`.
- To switch it off in one clone, remove its entry from `.claude/settings.json`.
- `bun run lint:fix` sweeps the whole tree with the same fixes. Its autofixes can also join a
  comment block that you wrapped by hand into one long line, so read the diff after a sweep.

## The privacy check

`bun run privacy` runs `scripts/privacy-check.ts` over the repository. It exists to stop private
data reaching a public repository: a private address, a home-folder path, a private network
address, a secret, or a term from your own denylist. It is ported from the service repository's
check, and its tests run in `bun test`.

### What it reads

Inside a git work tree, the check reads what git would track: the tracked files and the
untracked ones that git does not ignore. Ignored folders such as `node_modules/` and `.tmp/` are
not read. Outside a work tree, or in an ignored folder, it reads every file.

Each text file goes through these generic rules:

- `private-ip`: an address in a private range (`10.`, `172.16`–`172.31`, `192.168.`, or the
  shared range `100.64`–`100.127`).
- `home-path`: a home-folder path, except the placeholder users `user`, `tester` and `runner`.
- `email`: an address, except one at an example domain (`example.com`, `example.org`,
  `example.net`), a reserved `.test`, `.example`, `.invalid` or `.localhost` domain, or a
  GitHub no-reply address. No address is allowed by name.
- `telegram-token` and `telegram-chat`: the shapes of a bot token and a chat id.

A PNG or JPEG is read for text and metadata chunks, and one that holds any is `image-metadata`.
Any other binary is `binary-unreviewed`, unless it is listed as reviewed. A symbolic link is
`symlink-unreviewed`. A lockfile skips the `word:` denylist rules, because its hashes would
match by chance.

A reviewed binary goes in `.privacy-reviewed`, one `sha256  path` per line, with `#` comments
allowed. It passes while its content still matches the hash, and a changed file is reported
again.

Unless `--no-gitleaks` is given, `gitleaks dir` scans the same folder, and its hits print as
`gitleaks:<RuleID>`.

A finding prints as `file:line label`, never the text that matched, and the output ends with a
count. The exit codes are:

- `0`: nothing found.
- `1`: findings.
- `2`: the scan could not run, such as gitleaks missing from `PATH` without `--no-gitleaks`, or a
  denylist line that does not parse.

### The denylist

A denylist is a TSV file kept outside git, named by `PRIVACY_DENYLIST=<file>` or by
`--denylist <file>`, where the flag wins. The template ships none. Its lines are of three kinds.
`#` comments and blank lines are skipped:

- `label`, then a tab, then a regex: a rule. The regex matches case-insensitively anywhere in a
  line, and a match is a finding named `label`.
- `word:` followed by a label, then a tab, then alternatives separated by `|`: a word-start rule.
  Each line is cut into words at every character that is not a letter and at each change from a
  lower-case to an upper-case letter. A word that starts with one of the alternatives is a
  finding named by the label. Only word starts count, so a term that is the end of a longer word
  is not a hit.
- `allow`, then a tab, then one exact phrase: removed from a line before the `word:` rules read
  it. The phrase itself is no finding, and the same word elsewhere on the line still is.

Keep the file private. Never print, paste or commit its contents. A finding shows the label and
not the matched text, and a commit message or report that names a removed term describes it by
kind, such as "a private repository name", never by the word itself.

### Publishing with `scripts/public-export.ts`

To publish a clone as a public repository with a fresh history, run the export from inside the
clone:

```sh
PRIVACY_DENYLIST=<file> bun scripts/public-export.ts \
  --author "Your Name <you@example.test>" <target>
```

`--author` is the identity the public commit carries, as its author and its committer. The export
never takes it from git, because it is published with the commit, and the identity this machine's
git gives may be a work or a private address. Name the one the public history should show, such
as a GitHub noreply address.

The target must be a new or empty folder, and the script creates it when it is missing. Name it
outside the clone, or in `.tmp/`, which git ignores and the check reads whole. The export then:

1. Refuses to run unless `--author` reads as `Name <email>`, `PRIVACY_DENYLIST` names an existing
   file, and gitleaks is on `PATH`.
2. Writes `git archive HEAD` into the target. Only committed content goes in, so uncommitted
   changes are not exported.
3. Runs the privacy check over the target with the denylist and gitleaks. On findings it prints
   them, exits 1, leaves the exported files for you to read, and makes no `.git` and no commit.
4. When the scan is clean, runs `git init -b main` in the target and makes one commit,
   `chore: first public release`, by the `--author` identity. It adds no remote.
5. Prints the two commands that add a remote and push `main`, and runs neither.

It exits 0 when it commits, 1 on findings, and 2 when it could not run.

### Why it is built this way

The alternatives were rejected for these reasons:

- **Rewriting this history** needs a force push, and the earlier project's code stays in every
  commit. A fresh first commit from `HEAD` leaves that code out.
- **A word list in the repository** names the very things it hides.
- **Hashed words in the repository** do not hide short names: a dictionary recovers them in
  seconds.
- **A check written from scratch** would be new and untested. The service repository's check is
  in use and tested, so this one is ported.
- **A denylist in the user's config directory** was declined. The file sits in a folder of the
  clone that git ignores, which every worktree of the clone reaches by path.
