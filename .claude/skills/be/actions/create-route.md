# /be create-route <entity>

Creates one backend resource: its folder under `src/routes/`, its flows, its repository, its
routes, its MCP tools and its tests. The reference for every layer is `src/routes/info/`. Ask
before you write anything.

## Ask first

Put the eight checks to the user in this order, one question each, and wait for each answer. Do
not write a file until all eight are settled.

1. **Name.** The singular noun and its plural path segment, such as `widget` and `widgets`. The
   folder is `src/routes/<plural>/`, the id parameter is `<singular>Id` (`widgetId`, never `id`),
   and tool names start with `<singular>_`.
2. **Parent.** Is this a sub path, such as `/widgets/:widgetId/parts`? If so, name the parent
   entity. A sub path nests inside its parent's folder, `src/routes/<parent>/<child>/`, and its
   input schema carries the parent's id field too. Its relative imports climb one
   directory more than the parent's, three levels up to `src/errors.ts`. If not, the answer is none.
3. **Methods.** Which of these: `list` (GET the collection), `get` (GET one), `create` (POST),
   `update` (PATCH, a partial change), `replace` (PUT, the whole entity) and `delete` (DELETE).
   Each one is one flow file, `src/routes/<plural>/<verb>.flow.ts`, where `<verb>` is the method's
   name from that list. A caller who names HTTP methods instead means these: GET on the
   collection path (`/widgets`, `/widgets/:widgetId/parts`) is `list`, GET on one id is `get`,
   POST is `create`, PATCH is `update`, PUT is `replace` and DELETE is `delete`. Say which verbs
   you read before you go on.
4. **Fields.** The entity's fields, which are required on create, and which are optional on
   update.
5. **Table.** Does a table hold the entity? If not, run `/db add <table>` first and come back to
   this action. If it does, name the table so the repository reads the right one.
6. **MCP tool.** Does each route also mirror an MCP tool? The default is yes, named
   `<singular>_<verb>`, such as `widget_get`.
7. **Web only.** Does any of these routes exist only for the web app? A route with no tool is a
   `webRoute()`, which lists no tool in `ROUTES`.
8. **Go ahead.** Summarise the files you will write, then ask for a yes before you write them.

## Files to write

**Contract:** `src/routes/<plural>/contract.ts` holds one strict input schema per route, and
the output schema. `info` is the example:

```ts
// src/routes/info/contract.ts
export const InfoInputSchema = z.strictObject({})

export type InfoInput = z.infer<typeof InfoInputSchema>
```

Use `z.strictObject`, so a stray field is refused, not dropped. The id field is
`IdSchema` from `src/routes/common.ts`, which accepts a number from the MCP surface and digits
from a URL.

**Flows:** `src/routes/<plural>/<verb>.flow.ts`, one file per method. A flow is a function over
an injected `deps`. `src/routes/info/get.flow.ts` is the example:

```ts
// src/routes/info/get.flow.ts
export interface ServiceInfoDeps {
  readonly env: Record<string, string | undefined>
  readonly dialect: 'sqlite' | 'pg'
  readonly log: Log
}

export function getServiceInfo(_input: InfoInput, deps: ServiceInfoDeps): ServiceInfo {
```

A flow imports its own contract and `src/errors.ts`, and from `src/logging.ts` only `scoped` and
`import type { Log }`, and nothing else from the layers above. Its `deps` names a store with only
the methods that flow calls. A missing row is a thrown `NotFoundError` from `src/errors.ts`, which
`statusFor` maps to a 404:

```ts
// src/routes/<plural>/get.flow.ts
export interface GetWidgetDeps {
  readonly store: { get(id: number): Promise<Widget | undefined> }
}

export async function getWidget(input: WidgetGetInput, deps: GetWidgetDeps): Promise<Widget> {
  const found = await deps.store.get(input.widgetId)
  if (found === undefined) throw new NotFoundError('widget', input.widgetId)
  return found
}
```

**Repository:** `src/routes/<plural>/repository.ts` takes a `Db` from `src/data/repositories/db.ts`
and reads or writes the tables imported from `src/data/active.ts`. It returns an object with one
method per store call the flows make. That object fits every flow's `deps` by shape, because
TypeScript accepts a value with more methods than a `deps` store names, so write no `implements`.
A multi-statement write goes through `transact(db, body)` from `src/data/active.ts`, never
`db.transaction`. `src/data/repositories/config.ts` shows a repository that takes `db` first.

- Read the row with `const [row] = await db.select()...`, and write with `.returning()`, which
  both dialects have. `.get()` and `.all()` are SQLite's only and fail `bun run typecheck:pg`.
- A timestamp column reads back as a `Date`, which JSON sends as a string. Map each row to the
  contract's output in the repository, with `createdAt.toISOString()`, so both surfaces answer
  the shape the output schema states.
- A partial update builds its `set` with `pickDefined` from `src/data/repositories/pick-defined.ts`.
  When nothing is left to set, return the current row: drizzle throws `No values to set` on an
  empty `set({})`.
- SQLite does not enforce foreign keys; see Known limitations below for a sub path's checks.

**Route:** `src/routes/<plural>/http.ts` builds one spec per method with `route()`, which takes
the tool's name, the tool's input schema object, and the route's description: a one-line
`summary` and the contract's `output` schema, the `data` a success answers. The OpenAPI
document at `GET /api/openapi.json` reads all of it, and a route without a description fails
typecheck. `src/routes/info/http.ts` is the example:

```ts
// src/routes/info/http.ts
export const infoRoute = route('get', '/info', 'service_info', InfoInputSchema, {
  summary: 'The service id, name and version, its database dialect, and whether ...',
  output: ServiceInfoSchema,
}, async (input, { log }) =>
  getServiceInfo(input, { env: process.env, dialect: DIALECT, log: inDomain(log, DOMAIN) }))
```

A `list` route's output is the array, such as `z.array(WidgetSchema)`, and a `delete` route's is
what its flow returns.

`run` receives one context as its second argument, `{ db, log, pathOnly }`: the database, which
`info` never reads, the request's log, on which the route binds the `DOMAIN` its contract
exports, and the `options.pathOnly` values. A route over a table builds its store from `db`:

```ts
// src/routes/<plural>/http.ts
route('get', '/widgets/:widgetId', 'widget_get', WidgetGetInputSchema, {
  summary: 'Reads one widget.',
  output: WidgetSchema,
}, async (input, { db }) => getWidget(input, { store: widgetStore(db) })),
```

A path parameter is named after a field of that schema, so `/widgets/:widgetId` needs a
`widgetId` field, and `:id` is refused. A path that names a parameter its schema does not
name passes it as `options.pathOnly`, which `src/http/handler.ts` describes. A route with no
tool uses `webRoute()` from `src/http/route.ts` instead, with the same description. Export the
resource's specs as one array, such as `widgetRoutes`, and spread it into `ROUTES` in
`src/routes/http.ts`
(`[infoRoute, ...widgetRoutes]`). A sub path's array is spread there too, beside its parent's.

**Tool:** `src/routes/<plural>/tool.ts` builds one tool per route with `defineTool`, using the
same input schema object the route uses. `src/routes/info/tool.ts` is the example:

```ts
// src/routes/info/tool.ts
export const infoTool: ToolDefinition = defineTool({
  name: 'service_info',
  title: 'Service info',
  description: 'Returns the service id, name and version, ...',
  input: InfoInputSchema,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (input, { log }) =>
    getServiceInfo(input, { env: process.env, dialect: DIALECT, log: inDomain(log, DOMAIN) }),
})
```

A tool's `run` also receives one context second, `run: async (input, { db, log }) => ...`; it
binds the same `DOMAIN` on `log` and builds the same store the route does. Set
`readOnlyHint: true` on `list` and `get` only, and `destructiveHint: true` on `delete`. Export
the tools as one array, such as `widgetTools`, and spread it into `ALL_TOOLS` in
`src/routes/tools.ts`, in the same order as the routes.

**Logging:** every line names its caller as a hierarchy: the domain, then the scope at the
flow's entry point, then the step of each call, next to the `traceId` the runtime binds on the
log of a request or a tool call. The domain is set once, in the route folder's contract:

```ts
// src/routes/<plural>/contract.ts
export const DOMAIN = 'Widgets';
```

Both transport files, `src/routes/<plural>/http.ts` and `src/routes/<plural>/tool.ts`, bind it
with `inDomain(log, DOMAIN)` from `src/logging.ts` and pass the child to the flow. A transport
file logs nothing itself. The flow binds its scope at its entry point with
`scoped(deps.log, '<verb>')`, the verb of its method, and logs each crumb as a step. The step and
the call's data go in that line's context object, never in a binding:

```ts
// src/routes/<plural>/http.ts
route('post', '/widgets', 'widget_create', WidgetCreateInputSchema, {
  summary: 'Creates one widget.',
  output: WidgetSchema,
}, async (input, { db, log }) =>
  createWidget(input, { store: widgetStore(db), log: inDomain(log, DOMAIN) }))

// src/routes/<plural>/create.flow.ts
export async function createWidget(
  input: WidgetCreateInput,
  deps: CreateWidgetDeps,
): Promise<Widget> {
  const log = scoped(deps.log, 'create')
  log.debug({ step: 'validate' }, 'input checked')
  const row = await deps.store.insert(input)
  log.info({ step: 'insert', widgetId: row.id }, 'widget created')
  return row
}
```

The log reaches the flow through `run(input, { db, log })` and not as an ambient context, which
the portable core cannot read, nor as a positional argument, which would sit in a different place
for a route and a tool. A flow imports only `scoped` and `import type { Log }` from
`src/logging.ts`, and the lint rule enforces that.

The level rule: a routine step logs at `debug` or `trace`, and most steps are routine. Only a
key step on the use case's critical path logs at `info`, and a flow has few. A step that went
wrong logs at `warn` or `error` with the failure's code, never its secret detail. A flow never
logs an input body, a token or a password.

**Documentation:** every exported symbol in the files above gets a TSDoc block, `/** ... */`
before it, saying what it holds or does in this resource. A function's block names its
parameters with `@param name - text`, its result with `@returns`, and each error it throws with
`@throws {NotFoundError}` and the condition. `bun run docs:typedoc` renders the blocks into
`.docs/typedoc/`, and `docs/documentation.md` holds the rest of the rules.

## Tests

Put the flow tests under `tests/routes/<plural>/`, and every test that reads or writes the
database under `tests/integration/routes/<plural>/`, where `bun test` and CI never run it. The
three test files in `tests/routes/info/` show the shapes: a flow test, a route test and a tool
test. Its route reads no table, so its route and tool tests stay unit tests.

- **Flows:** one `<verb>.flow.test.ts` per flow, each with a fake store, a plain object with the
  methods the flow calls. Cover the found row and the missing one. The flow's log is
  `captureLog().log` from `tests/support/capture-log.ts`, bound with
  `inDomain(captured.log, 'Widgets')`. Assert each record's scope, step, level and domain, as
  `tests/routes/info/get.flow.test.ts` does.
- **Repository:** an integration test at `tests/integration/routes/<plural>/repository.test.ts`,
  on a scratch Postgres database from `openTestDatabase()` in `tests/support/test-db.ts`. Open it
  in `beforeAll`, call `reset()` and seed in `beforeEach`, and `close()` it in `afterAll`. Check
  stored rows with its `sql` handle, so an assertion does not lean on the code it tests. Postgres
  hands back real booleans, `jsonb` as values and timestamps as `Date`.
- **Route:** a route test through `startTestServer` from `tests/http/harness.ts`, mounted with
  `mountRoutes(app, db, log)` on a scratch database opened the same way, where `log` is a
  `captureLog().log`. It reads the database, so it is an integration test too, at
  `tests/integration/routes/<plural>/http.test.ts`.
  Assert four things: a bad field gets a 400 whose `error.message` leads with the field's path, a
  missing id gets a 404 with the name `NotFoundError`, a stray key gets a 400, and the flow's line
  on a request carries the `DOMAIN` from the contract, as `tests/routes/info/http.test.ts` does. A
  stray key comes back as `Unrecognized key: "<key>"` in `error.message` with no field path before
  it, so assert the key there.
- **Tool:** a tool test through `connectTools` from `tests/support/tool-harness.ts`, on a scratch
  database as well, at `tests/integration/routes/<plural>/tool.test.ts`.
- **Route table:** `tests/http/routes.test.ts` probes every route in `ROUTES` with a stray key and
  expects a 400, so a route whose schema is not strict fails it.
- **API docs:** `tests/http/openapi.test.ts` checks that every route in `ROUTES` is one operation
  of the OpenAPI document, so a new route is covered once it is listed. Its input must be an
  object schema, or the document refuses it, naming the route.
- **All tools:** `tests/mcp/all-tools.test.ts` imports `ALL_TOOLS`, so it checks each new tool
  once it is listed. Its test "holds only service_info while OPEN_NOTEBOOK_URL is unset" pins the
  exact list, and it fails the moment a tool is added. Add the new tool names to that
  expectation in the same change.

`bun run lint` checks the import rules on every file you wrote, through its template/layer-imports
rule. Run it with the rest.

## Verify

Run `bun run typecheck && bun run typecheck:pg && bun run lint && bun test`, then
`bun run db:up && bun run test:integration`. `bun test` leaves `tests/integration/` out, so it
never runs the repository, route and tool tests; only the second command does, and it fails when
the server is down.

## Known limitations

SQLite does not enforce foreign keys, and the template leaves that to the implementor rather than
wrapping SQLite to behave like Postgres.

- SQLite runs with foreign keys off. Its `getDb()` never turns
  `PRAGMA foreign_keys` on, so a key's `onDelete: 'cascade'` and the parent-exists check act on
  Postgres only.
- On SQLite a delete removes no related rows. The implementor handles it one of two ways: a helper
  in the route's repository that deletes the children and then the parent in one
  `transact(db, body)`, or an independent delete query that the flow calls first. A sub path's
  parent `delete` removes its children this way.
- A child write on SQLite does not check that its parent exists. A sub path's flows check it and
  throw `NotFoundError` for the parent.
