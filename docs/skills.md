# Project skills

A project skill is a set of written steps that Claude Code follows for one kind of change in this
repository. This page says what a skill is here, how Claude Code runs one, and what each of the five
built actions does: its call, its arguments, what it creates, what to run after it, and one worked
example. It ends with the logging rule that every generated backend file follows.

## What a project skill is

A project skill is a folder under `.claude/skills/` whose main file is SKILL.md. That file starts
with two fields. `name` is the skill's name. `description` says when the skill applies and lists the
words that point to it. The rest of the file is a router: a table that maps each call to one action
file.

An action file holds the steps for one change. It says what to ask you, which files to write and
which commands to run afterwards. A skill can also keep reference files. The router or an action
points to one by its path when it needs it.

This repository has three skills:

- `be`, for backend routes. It has one action, `create-route`.
- `db`, for the database. It has three actions, `add`, `update` and `migrate`, and three reference
  files.
- `fe`, for web pages. It has one action, `empty-page`.

The `fe` router also names five actions that are planned and not built: `list-page`, `crud-page`,
`modal-view`, `form-flow` and `wizard-flow`. No file exists for any of them, so calling one does
nothing. Use `empty-page` instead, then compose the page by hand from the component library's
stories.

## How Claude Code runs one

You call a skill by its group, then its action, then its arguments, as in `/be create-route note`.
Claude Code then follows these steps:

1. It loads the router, SKILL.md, and finds the row for your call. Claude Code loads a project skill
   when its `description` matches your request, and also when you call it by name.
2. It reads only the one action file that row names. Each router reads only the action file it
   names, and a reference file is opened only when the action or the router points to it.
3. Where the action asks first, it puts each question to you, one at a time, and waits for each
   answer before it writes a file. `/be create-route` asks eight questions, and `/fe empty-page`
   asks four. Both end with a summary and a request for a yes. `/db add` asks one question at the
   end, whether the table needs starting rows. `/db migrate` prints the SQL of each new migration
   before it applies it.
4. It writes the files the action lists and runs the commands it names. A `PostToolUse` hook runs
   `eslint --fix` on each file that an `Edit` or `Write` changes, as [the ESLint
   hook](setup.md#the-eslint---fix-hook) describes. The hook repairs what it can, so the commands at
   the end of each action still decide whether the change is done.

## The five actions

Each action below gives its call, its arguments, what it creates, what to run after it, and one
worked example. The example names are illustrative.

### `/be create-route <entity>`

**Action file.** `.claude/skills/be/actions/create-route.md`, which the router names.

**Call.** `/be create-route <entity>`, where `<entity>` is the singular noun, such as `note`.

**Arguments.** Only the singular noun. The skill asks for the rest, in this order: the plural path
segment, the parent when the route is a sub path, the methods, the fields, the table, whether each
route mirrors an MCP tool (the default is yes), and whether any route is for the web app only.

**Creates.** Under `src/routes/<plural>/`: contract.ts, which holds the strict input and output
schemas and the domain; one flow file per method, named `<verb>.flow.ts`; repository.ts, which holds
the drizzle queries over a `Db`; http.ts, with one route per method; and tool.ts, with one tool per
route. Under `tests/routes/<plural>/`: a test for each flow, on a fake store. Under
`tests/integration/routes/<plural>/`: a repository test, a route test and a tool test, each on a
scratch Postgres database. It also adds the route array to `ROUTES` in `src/routes/http.ts`, adds
the tools to `ALL_TOOLS` in `src/routes/tools.ts`, and adds the new tool names to the exact list in
`tests/mcp/all-tools.test.ts`.

**Run after.** Run `bun run typecheck && bun run typecheck:pg && bun run lint && bun test`, then
`bun run db:up && bun run test:integration`. `bun test` leaves `tests/integration/` out, so a green
`bun test` has not run the repository, route and tool tests.

**Example.** The `notes` table already exists, from `/db add notes`. Run `/be create-route note`.
The answers are: the plural is `notes`; there is no parent; the methods are `get` and `create`;
`title` is required on create; the table is `notes`; each route mirrors a tool; and no route is web
only. The skill summarises the files and waits for a yes. The routes are `GET /api/notes/:noteId`
and `POST /api/notes`, and the tools are `note_get` and `note_create`. Then run the commands above.

### `/fe empty-page <name>`

**Action file.** `.claude/skills/fe/actions/empty-page.md`, which the router names.

**Call.** `/fe empty-page <name>`, where `<name>` is the file stem, such as `reports`. The page's
URL is `/<name>`.

**Arguments.** The name, from the call. The skill asks for the nav label, such as `Reports`, and for
an icon, which is a Lucide name that the library's `IconName` accepts. Then it asks for a yes after
a summary.

**Creates.** `src/web/pages/<name>.tsx`, which exports a pure `<Name>View` and a `<Name>Page`, and
`tests/web/<name>.test.tsx`. It adds one entry to `PAGES` in `src/web/app.tsx`, placed after the
landing entry, and adds `'/<name>'` to `APP_PATHS` in `src/http/server.ts`. It also updates two
pinned lists, in `tests/http/server.test.ts` and in `tests/web/pages.test.tsx`, because those tests
fail until their lists match.

**Run after.** Run
`bun run typecheck && bun run lint && bun test tests/web tests/http/server.test.ts`. To see the page
in the app, restart `bun run serve`, which builds the app first, as [the web
build](setup.md#the-web-build) describes.

**Example.** Run `/fe empty-page reports`, with the label `Reports` and an icon such as `house`. The
skill creates the page file and its test under the `reports` name, and the page is served at
`/reports`. Then run the commands above.

### `/db add <table>`

**Action file.** `.claude/skills/db/actions/add.md`, which the router names.

**Call.** `/db add <table>`, where `<table>` is the table's name in SQL, such as `notes`.

**Arguments.** The table name. The area that the table belongs to, such as `config` or `auth`, names
the file it goes in.

**Creates.** The table is written twice, once in `src/data/sqlite/tables/<area>.ts` and once in
`src/data/pg/tables/<area>.ts`, with the same table name, key and column names. Its export is added
to `src/data/sqlite/index.ts`, to `src/data/pg/index.ts` and to `src/data/active.ts`. Four tests
that pin the table list get the new name. Then two migrations are generated,
`drizzle/sqlite/<NNNN>_add-<table>.sql` and `drizzle/pg/<NNNN>_add-<table>.sql`, each with its
journal entry. Each file names only the new table. A seed file is written only when you say the
table needs starting rows.

**Run after.** Run `bun test tests/data/journal.test.ts` before any migrate, and do not migrate
while it fails. Then run `bun run db:migrate`, and `bun run db:status`, which must read `applied` on
every line. Then run
`bun run typecheck && bun run typecheck:pg && bun run lint && bun test tests/data`.
`bun run db:generate` writes only the active dialect's folder, so the other dialect's migration
comes from the drizzle-kit command in step 4 of `.claude/skills/db/actions/add.md`.

**Example.** Run `/db add notes`, with the area `notes`. The table has a text `title` column and a
generated id, copied from the `apiToken` table in `src/data/sqlite/tables/auth.ts`. The SQLite
migration is numbered `0001` and named `add-notes`, and it holds one `CREATE TABLE` for `notes`.
`bun run db:migrate` then logs `"applied":1`. The route in the `/be create-route note` example reads
this table.

### `/db update <table>`

**Action file.** `.claude/skills/db/actions/update.md`, which the router names.

**Call.** `/db update <table>`, where `<table>` is the existing table.

**Arguments.** The table. Use this action when the rows already stored cannot satisfy the change: a
new `NOT NULL` column, a narrower type, or a new unique constraint. A new nullable column needs no
backfill, so `/db migrate` alone covers it.

**Creates.** Three migrations, one per step, and each is applied before the next is generated. They
are `<NNNN>_add-<column>.sql`, `<NNNN+1>_backfill-<column>.sql` and `<NNNN+2>_tighten-<column>.sql`,
one set for each dialect. The first and third steps edit both twin table files. The backfill is a
custom migration: its header is generated, and its SQL follows the rules in
`.claude/skills/db/reference/data-changes.md`.

**Run after.** Run the three steps in order:

1. Add the column loose, without `.notNull()`. Generate both dialects, run
   `bun test tests/data/journal.test.ts`, then run `bun run db:migrate`.
2. Backfill the existing rows. Generate the custom migration for both dialects, write its SQL, and
   run the journal test. Before the migrate, read the check query in the data-changes reference:
   `total` counts the rows, and `nulls` must equal it. Run `bun run db:migrate`, then read again:
   `total` must be unchanged, and `nulls` must be 0. A `total` of 0 means there was nothing to
   backfill, not that the check passed.
3. Tighten the column with `.notNull()`, the unique constraint or the narrower type. Generate both
   dialects with `--name tighten-<column>`, run the journal test, then run `bun run db:migrate`.

Do not generate step 3 until step 2 reads as above.

**Example.** The `notes` table has rows, and its `status` column must now be required. Step 1 adds
`status` as a nullable text column in both twins, so the existing rows read NULL in it. Step 2
writes a custom backfill that fills `status` for those rows, and the check reads `total` equal to
`nulls` before the migrate and `nulls` 0 after it. Step 3 changes both twins to `.notNull()`,
generates the tighten migration, and applies it.

### `/db migrate`

**Action file.** `.claude/skills/db/actions/migrate.md`, which the router names.

**Call.** `/db migrate`, with no arguments. It works on the active dialect, which is the one that
`#db` in `package.json` names. That is SQLite unless it has been switched.

**Arguments.** None.

**Creates.** Nothing by hand. The action runs `bun run db:generate`, which writes the migration for
any schema change into the active dialect's folder, `drizzle/sqlite/` or `drizzle/pg/`. When the
schema matches the last snapshot, it prints `No schema changes, nothing to migrate`. It then prints
the SQL of each new file, and applies it.

**Run after.** The action runs the checks itself. It runs `bun run db:status` before the migrate,
and stops on any `skipped` or `unknown` line, which needs the migration-recovery reference in
`.claude/skills/db/reference/migration-recovery.md`. It then runs `bun run db:migrate` and
`bun run db:status` again, and every line must read `applied`. The migrator logs one line under
`Db:migrate`. It reads `"applied":N` with the count it ran, or `"applied":0` with
`database already up to date`. A failure logs `migration failed` with a `code` and exits 1, and the
whole batch is rolled back.

**Example.** Add a nullable `pinned` column to `notes` in its SQLite table file, then run
`/db migrate`. The generated file holds one `ALTER TABLE ... ADD` for SQLite, which the skill
prints. The status reads `pending` before the migrate, and the migrator logs `"applied":1`. The
Postgres twin needs its own migration, from the drizzle-kit command in
`.claude/skills/db/actions/add.md`, because this action generates only the active dialect.

## The reference route

`service_info` is one example of each surface, and `/be create-route` builds the same shape. To add
a route or a tool by hand, copy it:

- `src/routes/info/contract.ts`: the input schema, which both sides parse with.
- `src/routes/info/get.flow.ts`: `getServiceInfo(input, deps)`, the work both sides call.
- `src/routes/info/tool.ts`: the MCP tool (`defineTool`).
- `src/routes/info/http.ts`: the HTTP route `GET /api/info` (`route`).
- `ROUTES` in `src/routes/http.ts` and `ALL_TOOLS` in `src/routes/tools.ts` are the lists that
  mount them. `src/app-config.ts` holds the id and name the reference route reports.

## The logging rule

Every backend file that a skill writes follows one rule. The vocabulary is defined in
`src/logging.ts`, and the rule is as follows.

- `domain` names the area, in PascalCase, such as `Notes`. The route folder's contract.ts exports it
  once, as `DOMAIN`.
- `scope` is the camelCase verb of the flow's entry point. The flow binds it once, with
  `scoped(deps.log, '<verb>')`, such as `create`.
- `step` is the camelCase verb of one call in that flow, given in that line's context object, such
  as `insert`.
- A line written while serving one HTTP request or one MCP tool call also carries that call's
  `traceId`. The runtime binds it, and no generated file sets it.
- The transport files, http.ts and tool.ts, bind the domain with `inDomain(log, DOMAIN)` and pass
  the child to the flow. They log nothing themselves.
- The data of a call, such as an id or a count, goes in the line's context object and never in a
  binding. Only `domain`, `scope`, `step` and `traceId` are bound on a child.
- A routine step logs at `debug` or `trace`. `info` is only for a key step on the use case's
  critical path, and a flow has few. A failing step logs at `warn` or `error` with its code, never
  its secret detail. A flow never logs an input body, a token or a password.

The generated files differ in what they log. A flow logs through the `log` its caller passes. A
repository logs nothing of its own. It logs only what it alone can see, such as a unique key that
clashes, as a step on the caller's `log`. Table files and migrations log nothing. A page imports
nothing from `src/logging.ts`, so it logs nothing either.

The lint rule template/layer-imports enforces the import side: a flow may import only `scoped` and
`import type { Log }` from `src/logging.ts`. Each flow test asserts the scope, step, level and
domain of every record, using `captureLog()` from `tests/support/capture-log.ts`. A generated flow
reads like this:

```ts
// src/routes/<plural>/create.flow.ts
export async function createWidget(
  input: WidgetCreateInput,
  deps: CreateWidgetDeps,
): Promise<Widget> {
  const log = scoped(deps.log, 'create');
  log.debug({ step: 'validate' }, 'input checked');
  const row = await deps.store.insert(input);
  log.info({ step: 'insert', widgetId: row.id }, 'widget created');
  return row;
}
```
