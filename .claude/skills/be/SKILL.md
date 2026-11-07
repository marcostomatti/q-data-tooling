---
name: be
description: Use when adding a new route, adding an endpoint, adding a sub path under an existing
  resource, adding an MCP tool beside a route, or adding a backend resource with its flows,
  repository and tests. Trigger words include "new route", "add a route", "new endpoint" and
  "create route".
---

# /be

The router for backend routes in this template. It has one action, `create-route`, and no other
`/be` action is built. Read only the action file you were called with.

| Call | Read |
| --- | --- |
| `/be create-route <entity>` | `.claude/skills/be/actions/create-route.md` |

Adding a table the route needs belongs to `/db`: run `/db add <table>` first, from
`.claude/skills/db/SKILL.md`.

## Where the pieces live

Every route is one folder under `src/routes/`, laid out as `src/routes/info/` is. Its layers:

- Route: `src/routes/info/http.ts` builds one `route(...)` spec from `src/http/route.ts`, and
  `ROUTES` in `src/routes/http.ts` lists it. `route()` mirrors one MCP tool; `webRoute()` in the
  same file mirrors none.
- Flow: `src/routes/info/get.flow.ts` holds the work, a function over an injected `deps`. It
  imports no transport, nothing under `src/data`, no drizzle and no repository.
- Contract: `src/routes/info/contract.ts` holds the strict zod input and output schemas. The
  route and its tool import the same input schema object.
- Repository: `src/routes/<plural>/repository.ts` takes a `Db` (`src/data/repositories/db.ts`)
  and holds the drizzle queries. `info` reads no table, so `src/data/repositories/config.ts` is
  the worked example of a repository, reading `app_config`.
- Table: `src/data/sqlite/tables/config.ts` and its twin `src/data/pg/tables/config.ts` hold
  `app_config`. A new table is a `/db add`.
- MCP tool: `src/routes/info/tool.ts` defines one tool with `defineTool`, and `ALL_TOOLS` in
  `src/routes/tools.ts` lists it.

The lint rule template/layer-imports (`eslint/rules/layer-imports.mjs`) enforces these import
rules: a flow imports no transport, nothing under `src/data`, no drizzle and no repository,
and from `src/logging.ts` only `scoped` and `import type { Log }`; a route file and a tool file
never import each other; `src/http` and `src/mcp` never import each other; and an entity imports
only zod and other entities.

Route paths are relative to `/api`, and a path parameter is named after a field of the tool's
schema (`:widgetId`, never `:id`), as the comment on `RouteSpec` in `src/http/route.ts` explains.
