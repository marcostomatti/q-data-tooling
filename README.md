# q-data-tooling

An SEC filings service, built for a tech assessment. It lists US companies from the SEC ticker
file, fetches each company's last year of filings from EDGAR, and links every filing to its
original document on sec.gov. Documents are linked, never downloaded. A summary page compares the
companies you select.

It is built on [`open-tomato/template-service`](https://github.com/open-tomato/template-service),
which brings sign-in, API keys, the HTTP API, MCP tools, the OpenAPI docs and backups.

## Prerequisites

- [Bun](https://bun.sh) 1.3.14 or later, which runs every command below.
- [Docker](https://docs.docker.com/get-docker/), running, because the database is Postgres 16 in
  a container that `docker-compose.yaml` defines. Nothing else needs installing.

## Setup and first run

Run these once, in order, from the project root. Each step says what it writes, so a step that
fails can be run again on its own.

1. Install the packages, and create `.env` from the example:

   ```sh
   bun install
   cp .env.example .env
   ```

   The copy already holds `DATABASE_URL` for the Postgres container. Every other line is
   commented out, and its default applies.

2. Tell SEC who is asking. SEC refuses requests without a declared User-Agent, so the service
   does not start without one. Open `.env` and set your app name and an email SEC can write to:

   ```ini
   SEC_USER_AGENT="q-data-tooling you@example.com"
   ```

3. Start the database, create its tables, and load the companies:

   ```sh
   bun run db:up && bun run db:migrate && bun run db:seed
   ```

   `db:up` starts the container and waits until it answers. `db:migrate` creates the tables,
   and `db:seed` loads the SEC ticker list. Both can run again safely: a second run skips what
   is already there.

4. Set the sign-in password, and an API key for curl and MCP clients:

   ```sh
   bun run set-password
   bun run set-api-key --burn-after-reading
   ```

   `set-password` asks for the password twice, then writes `AUTH_MODE=password` and the
   password's hash to `.env`; the password itself is never stored. `set-api-key` writes
   `API_KEY` to `.env` and shows it once.

5. Build the web app and start the service:

   ```sh
   bun run serve
   ```

   Open the address it prints, and sign in at `/login` with the password from step 4.

To stop the database, run `bun run db:down`; its data stays in a Docker volume for the next
`db:up`. To change the password, run `bun run set-password` again and restart `serve`. A lost
password is recovered with `bun run reset-credentials`, which removes the hash and signs out
every session and API token; then run `set-password` again.

## Live code

`bun run serve` builds the web app once, so it shows changes only after a restart. For editing
while the service runs, use `bun run dev` instead:

```sh
bun run dev
```

It restarts the service whenever a backend file changes, and rebuilds the web app whenever a
file under `src/` changes. A rebuild prints `dev: web app rebuilt; reload the page`, and a
reload of the browser shows it. Ctrl+C stops both.

`serve`, `dev` and `mcp` all read `SEC_USER_AGENT` before they open anything. The filings list
and `selected: true` sync a company's filings from SEC through the one client each builds
([spec](docs/specs/sec-filings.md)), at most 10 requests per second.

## API docs

`serve` answers the OpenAPI document at `/api/openapi.json` and a Swagger UI page at `/api/docs`,
both built from the route table. They need the same sign-in or API key as `/api`.
`bun run docs:generate` writes the OpenAPI file and the TypeDoc site.
[Documentation](docs/documentation.md) covers both.

## Gates

Run them in this order before a commit:

```sh
bun run lint
bun run typecheck
bun run typecheck:pg
bun test
bun run privacy                 # add `-- --no-gitleaks` when gitleaks is not installed
```

## Read next

The project's own pages:

- [Spec](docs/specs/sec-filings.md): the stages of work, from endpoints to the summary page.
- [setup-prompt.md](setup-prompt.md): the schemas, link templates and snippets the spec uses.
- [PLAN-sec-filings.md](docs/plans/PLAN-sec-filings.md): the task checklist the work runs through,
  stage by stage.

The template's pages, each covering one part:

- [Setup](docs/setup.md): the clone, the first migration and run, the configuration, every
  `package.json` script, the gates and the privacy check.
- [Skills](docs/skills.md): the project skills that generate a route, a page, a table or a
  migration.
- [Database](docs/database.md): the two dialects, Postgres for this project and SQLite for the
  tests, migrations and seeds.
- [Auth](docs/auth.md): sign-in with a password or OpenID Connect, API keys and API tokens.
- [Backup](docs/backup.md): scheduled dumps, `bun run backup` and restoring a dump.
- [MCP](docs/mcp.md): the service's tools for an agent, over stdio or HTTP.
- [Open Notebook](docs/open-notebook.md): a notes store that runs beside the service.
- [Web](docs/web.md): the web app, its pages and how to build it.
- [Documentation](docs/documentation.md): the API docs at `/api/docs`, read from the routes, and
  the TSDoc rules TypeDoc renders.
- [rafa](docs/rafa.md): the open-tomato command line for issues, pull requests and CI.
- [Template updates](docs/template-updates.md): bringing the template's latest `main` into this
  project.

For the layout and the rules that agents and reviewers follow, see [CLAUDE.md](CLAUDE.md).
