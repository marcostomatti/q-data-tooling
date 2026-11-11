# Backend map

Where each backend piece goes, one entry each, using `service_info` as the worked example. Every
path below is a real file in the tree; the web app under `src/web/` is not covered here.

- Route: `src/routes/<name>/http.ts` builds one `route(...)` spec from `src/http/route.ts`, and
  `ROUTES` in `src/routes/http.ts` lists it. `service_info` is `src/routes/info/http.ts`.
- Flow: `src/routes/<name>/<verb>.flow.ts` holds the work, a function over an injected `deps`, and
  imports no transport and nothing under `src/data`. `service_info` is
  `src/routes/info/get.flow.ts`.
- Contract: `src/routes/<name>/contract.ts` holds the strict zod input and output schemas that the
  route and the tool share. `service_info` is `src/routes/info/contract.ts`.
- Repository: the shared repositories in `src/data/repositories/<name>.ts` hold the drizzle queries
  over a `Db`. `service_info` reads no table, so its example is `src/data/repositories/config.ts`,
  which reads `app_config`.
- Table: `src/data/<dialect>/tables/<area>.ts`, one file per dialect (`sqlite` and `pg`).
  `service_info` has none; its example table is `app_config`, in `src/data/sqlite/tables/config.ts`.
- Migration: change the schema, run `bun run db:generate` to write the active dialect's
  `drizzle/<dialect>/`, then `bun run db:migrate` to apply it. The other dialect's migration needs
  its own drizzle-kit run, the command in `.claude/skills/db/actions/add.md` step 4. Commit the
  generated files with the schema change. `service_info` has none.
- MCP tool: `src/routes/<name>/tool.ts` defines one tool with `defineTool`, and `ALL_TOOLS` in
  `src/routes/tools.ts` lists it. `service_info` is `src/routes/info/tool.ts`.
- API docs: `route()` takes a description after the tool's schema, its `summary` and the
  contract's `output` schema, and `webRoute()` takes it after its schema. `buildOpenApiDocument`
  in `src/http/openapi.ts` reads `ROUTES` into the OpenAPI document served at
  `GET /api/openapi.json` and `GET /api/docs`, and `serviceDocument` in `src/routes/http.ts` adds
  the template's fixed routes: `/health`, the docs and the `/auth` routes of `AUTH_MODE`.
  `service_info` is described in `src/routes/info/http.ts`. `docs/documentation.md` holds the
  rules and the table of every route the template serves.
- TSDoc: every exported symbol gets a `/** ... */` block, with `@param`, `@returns` and `@throws`
  on a function. `bun run docs:generate` renders it with TypeDoc into `.docs/`.
- Integration test: `tests/integration/auth-flow.test.ts` is the only integration test, because
  sign-in is the only place the web app and the backend meet; `bun run test:integration` runs it
  with `tests/contract/`.
- Logging: every line carries a domain, a scope and a step, and every request and tool call carries
  a trace id. `info` is for the critical path only. `inDomain` and `scoped` from `src/logging.ts`
  set the domain and the scope.

The layout's import rules are the `template/layer-imports` ESLint rule, not tests: a flow imports no
transport and nothing under `src/data`, `src/http` and `src/mcp` never import each other, an entity
imports only zod and other entities, and so on. Keeping them as tests was rejected because a test
reads text with regexes and only runs in `bun test`; the lint rule also runs in the editor and
reports on the exact import. `template/no-drizzle-transaction` is the other local rule: only
`transact` in `src/data/pg/transaction.ts` calls drizzle's `transaction`.

Gates: `bun run lint`, `bun run typecheck`, `bun run typecheck:pg`, `bun test` and
`bun run privacy`, in that order. Without gitleaks on `PATH`, run
`bun run privacy -- --no-gitleaks`; `tests/privacy.test.ts` runs that scan in `bun test`, with the
denylist when `PRIVACY_DENYLIST` names it. `.githooks/pre-push` runs the same scan over the
commits a push sends, once a clone sets `git config core.hooksPath .githooks`. Each Edit or Write
runs `eslint --fix` on its file (`.claude/hooks/eslint-fix.ts`, registered in
`.claude/settings.json`), so what ESLint can repair by itself is fixed as it is written. Run
`bun run lint:fix` before the gates to sweep the rest, and fix by hand only what it leaves.

## Commands

Project skills under `.claude/skills/`. Call one by its group, then its action; each router reads
only the action file it names. Of the `/fe` actions only `empty-page` is built, and of `/be` only
`create-route`.

- `/fe empty-page <name>`: creates `src/web/pages/<name>.tsx`, its `PAGES` entry, its `APP_PATHS`
  entry and `tests/web/<name>.test.tsx`.
- `/be create-route <entity>`: creates `src/routes/<plural>/` with its contract, flows, repository,
  routes, MCP tools and tests.
- `/db add <table>`: creates the table in both `src/data/sqlite/tables/` and `src/data/pg/tables/`,
  its exports, and a migration for each dialect.
- `/db update <table>`: creates a column or constraint the stored rows need, as three migrations:
  add it loose, backfill it, then tighten it.
- `/db migrate`: creates the pending migration for the active dialect, shows its SQL and applies it.

## Template updates

A project made from this template brings in the template's later changes by merging its `main`:
`docs/template-updates.md` has the steps, from adding the `template` remote to the gates after.
Resolving a conflict between the two is the project's own call.

## Additional tooling

We use the `@open-tomato/rafa` CLI for issues, pull requests, CI and the other workflow tasks;
`docs/rafa.md` sets it up. Learn one command from `rafa <subject> <action> --help` when you
need it. `rafa describe --output=json` prints the whole roster, about 240 KB, so run it only in
an interactive session that asks for it, never in a loop task session, where every session would
read it again. When it is the intended next step in the workflow, prefer the command
suggested at the end of a rafa action's output over a self-written command that does the same.
Treat rafa's effort store, learnings and skills for work done in this project as the preferred
memory source of truth.

### Additional contexts

Use `rafa skill <action>` and `rafa agent <action>` to list and enable the skills and agents the
project needs. Do it once, then only on request, because the lists are long to read every session.
A loop task session skips it.
