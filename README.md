# template-service

A local-first service, published as a template. It is the chassis with no domain of its own:
sign-in, API tokens, an HTTP API, MCP tools and scheduled backups. Its reference route,
`service_info`, shows where a domain's code goes.

## Quick start on SQLite

You need [Bun](https://bun.sh). SQLite is the default database, so there is no Docker and no
server to run.

```sh
bun install
cp .env.example .env
bun run db:migrate
bun run setApiKey --burn-after-reading
bun run serve
```

`setApiKey` writes the key it makes into `.env` and shows it once. [The first
run](docs/setup.md#the-first-run) checks that the service answers.

## Read next

Each page covers one part, and the parts are optional. Start with the first and add the rest as
you need them.

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
- [Template updates](docs/template-updates.md): bringing the template's latest `main` into a
  project made from it.

For the layout and the rules that agents and reviewers follow, see [CLAUDE.md](CLAUDE.md).
