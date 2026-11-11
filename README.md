# q-data-tooling

An SEC filings service, built for a tech assessment. It lists US companies from the SEC ticker
file, fetches each company's last year of filings from EDGAR, and links every filing to its
original document on sec.gov. Documents are linked, never downloaded. A summary page compares the
companies you select.

It is built on [`open-tomato/template-service`](https://github.com/open-tomato/template-service),
which brings sign-in, API keys, the HTTP API, MCP tools, the OpenAPI docs and backups.

## Prerequisites

[Bun](https://bun.sh). SQLite is the default database, so there is no Docker and no database
server to run.

## Setup and first run

Run these once, in order, from the project root:

```sh
bun install
cp .env.example .env
bun run set-password            # asks for a password twice; writes AUTH_MODE and its hash to .env
bun run db:migrate              # creates data/app.db and its tables
bun run db:seed                 # loads the companies from the SEC ticker list
bun run serve
```

Then open the address `serve` prints and sign in at `/login` with that password.

- **The password** is never written anywhere. `set-password` stores only its scrypt hash, as
  `AUTH_PASSWORD_HASH` in `.env`, and sets `AUTH_MODE=password`. To change it, run
  `bun run set-password` again and restart `serve`. A lost password is recovered with
  `bun run reset-credentials`, which removes the hash and signs out every session and API token;
  then run `set-password` again.
- **An API key** is optional, for curl and MCP clients: `bun run setApiKey --burn-after-reading`
  writes one into `.env` and shows it once.
- **SEC requests** need a declared User-Agent. Add `SEC_USER_AGENT="<app name> <contact email>"`
  to `.env`; SEC refuses requests without one, and allows at most 10 per second.
- **The database** file is created by `db:migrate`, not by `serve`, so run it again after pulling
  new migrations. `db:seed` can run any number of times; it skips rows already there.

`db:seed` and `SEC_USER_AGENT` describe the finished service. Until the seed and the SEC client
are built ([spec](docs/specs/sec-filings.md), stages 2 and 3), the seed runs no files and the
variable is not read.

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

The template's pages, each covering one part:

- [Setup](docs/setup.md): the clone, the first migration and run, the configuration, every
  `package.json` script, the gates and the privacy check.
- [Skills](docs/skills.md): the project skills that generate a route, a page, a table or a
  migration.
- [Database](docs/database.md): SQLite by default, switching to Postgres, migrations and seeds.
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
