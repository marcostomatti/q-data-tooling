# Documentation

The service documents itself in two places, and both are built from the code, so neither is
written a second time. The HTTP API is an OpenAPI 3.1 document, read from the route table. The
code is a TypeDoc site, read from the TSDoc blocks in `src/`.

## The API docs

`mountRoutes` in `src/routes/http.ts` builds the document once, at start, from `ROUTES`, and
serves it beside the routes it describes:

- `GET /api/openapi.json` answers the document.
- `GET /api/docs` answers a Swagger UI page that reads it, from the installed `swagger-ui-dist`.

Both sit behind `requireApiAccess`, so they need the same credential as `/api` itself. A browser
signed in to the web app carries its session cookie and opens the page. Swagger UI's Authorize
button takes an API key or an API token as the bearer, which a write sent from the page needs,
since a cookie write also needs the CSRF header the page does not send.

The document is read from each route, through `buildOpenApiDocument` in `src/http/openapi.ts`:

| Part | Read from |
| --- | --- |
| Path parameters | The input schema's fields the path names, and the route's `pathOnly` schemas |
| Query parameters | The other fields, on a GET or a DELETE |
| JSON body | The other fields, on a POST, a PUT or a PATCH |
| 200 | `{ success: true, data }`, with `data` the route's `output` schema |
| 400, 401, 500 | The `ErrorEnvelope` component, `{ success: false, error: { name, message } }` |
| Summary | The route's `summary` |
| Tag | The path's first segment, so `/widgets/:widgetId` is `widgets` |

So a route documents itself by its description, which `route()` takes after its tool name and
input schema, and `webRoute()` after its input schema:

```ts
route('get', '/widgets/:widgetId', 'widget_get', WidgetGetInputSchema, {
  summary: 'Reads one widget.',
  output: WidgetSchema,
}, async (input, { db }) => getWidget(input, { store: widgetStore(db) }));
```

The description is required, so a route without one fails `bun run typecheck`. Two kinds of
route are refused when the document is built, with the route's method and path in the message,
and the service does not start: one whose input schema is not an object, and one whose path holds
an Express 5 optional segment (`{/:id}`) or wildcard (`*rest`), which OpenAPI cannot spell.
`tests/http/openapi.test.ts` checks that every route in `ROUTES` is one operation of the
document, by method and path.

`bun run docs:openapi` writes the same document to `.docs/openapi.json`, for a tool that reads
it offline: a client generator, a linter, or a diff of the API between two commits.

## The code docs

Every exported symbol in `src/` gets a TSDoc block, `/** ... */` before it. These rules apply to
every file, and `/be create-route` writes its files to them:

- Say what the symbol holds or does here, in a sentence. Its type is already in the signature.
- A function names each parameter with `@param name - text`, its result with `@returns`, and each
  error it throws with `@throws {ErrorType}` and the condition that throws it. A one-line function
  whose names say it all may keep only the sentence.
- Link a symbol with `{@link name}` when the reader needs it to follow the text.
- A file that is a script or an entry point opens with a block ending in `@module`, as
  `scripts/build-web.ts` does.

`bun run docs:typedoc` renders the blocks into `.docs/typedoc/`, using `typedoc.json` and
`tsconfig.docs.json`, which read `src/` and leave out the tests and the built web bundle. Open
`.docs/typedoc/index.html` to read it.

`bun run docs:generate` runs both. `.docs/` is gitignored, so the output is never committed.
