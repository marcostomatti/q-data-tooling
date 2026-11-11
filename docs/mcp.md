# MCP

This page covers the MCP server: the tools it offers an agent, its two transports (stdio and
HTTP), the `.mcp.json` file that starts it for Claude Code, how to add it to a client, the logs it
writes and the trace id each tool call carries. [Setup](setup.md) gets the clone running, and its
[configuration](setup.md#configuration) table lists every variable this page uses.

## What it is and when to turn it on

The MCP server lets an MCP client, such as Claude Code or another agent, call the service's tools
over the Model Context Protocol. It is a separate process from `bun run serve`. Running the service
needs none of it, and the server needs no running service. It reads the same `.env` and the same
database, so its answers follow the same configuration.

Turn it on when an agent should call the service. Two transports carry it:

- **stdio**, the default and the supported path. The client starts `bun run mcp` as a child
  process and talks over its standard input and output, so no port opens. Nothing authenticates
  it. Whoever can start the process can call every tool, so the API key, the tokens and sign-in
  play no part.
- **HTTP**, opt-in with `MCP_TRANSPORT=http`. The server listens on port 8080, or on `PORT` when
  that is set, on every network interface. A taken port moves to the next free one, which the
  `started` line names. Nothing authenticates it either: anyone who reaches the port can call
  every tool, writes included. Use it only behind a firewall that admits loopback alone, or behind
  your own proxy.

### The tools

`ALL_TOOLS` in `src/routes/tools.ts` lists the tools every server offers. It holds five today:

| Tool | Title | What it returns |
| --- | --- | --- |
| `service_info` | Service info | The service id, name and version, the database dialect (`sqlite` or `pg`) and whether the notebook tools are on. It takes no arguments and only reads. |
| `company_list` | List companies | One page of companies with the total across every page, matched by ticker prefix or name with `q` and filtered by `selected`. It only reads. |
| `company_update` | Update a company | The company with `ticker`, after setting whether it is in the summary from the required `selected` flag. It fails when no company trades under the ticker. |
| `filing_list` | List filings | The company with `ticker` and one page of its 10-K, 10-Q and 8-K filings with their SEC links, filtered by base form with `form` and sorted by filing date with `sort`. It fails when no company trades under the ticker, and only reads. |
| `filing_summary` | Summarize filings | One page of the companies in the summary, each with its filing counts per form and in total and its latest 10-K, narrowed by base form with `form`. It only reads. |

When `OPEN_NOTEBOOK_URL` is set and the notebook answers at startup, `src/mcp/server.ts` adds eight
more after those. They are the [Open Notebook](open-notebook.md) tools:

- `notebook_list` and `notebook_create` list and create notebooks.
- `notebook_source_list`, `notebook_source_get`, `notebook_source_add_text` and
  `notebook_source_delete` work on the sources of one notebook.
- `notebook_search` searches a notebook, and `notebook_note_add` adds a note to one.

A successful call returns one text block of JSON. A failed call returns `isError: true` with one
text block, `{"error": {"name": "<the error's name>", "message": "<the message>"}}`. A new tool is
added by `/be create-route`, which [the skills page](skills.md) describes, and the tool is listed in
`ALL_TOOLS` in the same change.

### Logs and trace ids

Over stdio, stdout carries the protocol, so every log line goes to stderr, the package's own lines
included, and stdout holds JSON-RPC alone. Over HTTP the same lines go to stdout. `LOG_LEVEL`
filters them, and `LOG_FORMAT` picks their shape: `json` writes one pino-shaped JSON object a
line, `terminal` one readable line, and unset picks `terminal` when the log's output is a terminal
and `json` when it is not, as when a client starts the server. The start lines are logged under
domain `Mcp` and scope `start`, and the package's `started` line follows them:

```text
{"level":30,"time":1794081158289,"service":"template-service","domain":"Mcp","scope":"start","step":"register","tools":1,"msg":"registered MCP tools"}
{"level":30,"time":1794081158289,"service":"template-service","domain":"Mcp","scope":"start","step":"addNotebook","notebookTools":0,"msg":"notebook tools off: OPEN_NOTEBOOK_URL is not set"}
{"level":30,"time":1794081158291,"service":"template-service","version":"unknown","transport":"stdio","features":{},"msg":"started"}
```

Each tool call gets a new `traceId`, a random UUID, and every line written while that call runs
carries it. Two calls never share one. The MCP route does not read the caller's `x-request-id`,
unlike the HTTP routes. `service_info` writes one debug line, so its trace id shows only at
`LOG_LEVEL=debug` or lower:

```json
{"level":20,"time":1794081158309,"service":"template-service","traceId":"c7d3e367-4c99-44f1-8052-0aa107defca0","domain":"Info","scope":"get","step":"read","dialect":"sqlite","notebook":false,"msg":"service info read"}
```

## Setup from zero

Start from [setup](setup.md): clone the repository, run `bun install` and copy `.env.example` to
`.env`. SQLite needs no more. Once a tool reads a table, run `bun run db:migrate` first, as
[setup](setup.md#the-first-migration) says.

### stdio

The clone holds a `.mcp.json` with one server entry:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "template-service": {
      "command": "bun",
      "args": ["run", "mcp"]
    }
  }
}
```

The command runs in the directory the client starts it from, so `.env` and `data/app.db` are read
from there. Claude Code reads a project's `.mcp.json` from the project root, and it asks you to
approve a project server the first time it sees one. Open the clone in Claude Code and approve it.

To add the server yourself, with the clone's absolute path so that the start directory does not
matter:

```sh
claude mcp add --transport stdio template-service -- bun run --cwd /absolute/path/to/clone mcp
```

Any other client that starts a stdio server takes a command and its arguments. Use `bun`, with
`run --cwd`, the absolute path of the clone and `mcp`. Most clients write it in this shape:

```jsonc
// the client's MCP settings, in the shape most clients share
{
  "mcpServers": {
    "template-service": {
      "command": "bun",
      "args": ["run", "--cwd", "/absolute/path/to/clone", "mcp"]
    }
  }
}
```

A client with another file format takes the same command and the same arguments.

### HTTP

Opt in and start the server in a terminal, and leave it running:

```sh
MCP_TRANSPORT=http bun run mcp
```

Point a client at `http://localhost:8080/mcp`, or at the `url` the `started` line names when 8080
was taken. For Claude Code:

```sh
claude mcp add --transport http template-service http://localhost:8080/mcp
```

The transport is Streamable HTTP and stateful. A client's `initialize` gets a session id, which the
client sends on its later requests. The server keeps one session per start, so a second client,
or a client after a disconnect, needs a restart of the server.

The package also starts a health endpoint, at `http://localhost:3001/health` by default.
`HEALTH_PORT` moves it, and `PORT` moves only the MCP port. A taken port, either one, falls back
to the next free one with a warning, and the `started` line names the bound addresses as `url` and
`healthUrl`.

## Configuration

These are the MCP rows of the [configuration table](setup.md#configuration), with the same meaning.

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `MCP_TRANSPORT` | unset, stdio | `stdio` or unset for stdio. Only the exact value `http` opts in to HTTP. Any other value exits 1 at start. | `src/mcp/transport.ts`, `src/mcp/server.ts` |
| `PORT` | `8080` for MCP over HTTP | The port of the MCP HTTP transport. A whole number from 1 to 65535. It does not move the health port. | the service-mcp package |
| `PORT_STRICT` | unset | `true` stops the start with an error naming the port when it is taken. Unset, a taken port falls back to the next free one with a warning. | the service-express package, the service-mcp package |
| `HEALTH_PORT` | `3001` | The port of the health endpoint the MCP server starts over HTTP. A whole number. `PORT` does not move it. | the service-mcp package |
| `HEALTH_PORT_STRICT` | unset | `true` stops the MCP server when the health port is taken. Unset, it falls back to the next free one with a warning. | the service-mcp package |
| `LOG_LEVEL` | `info` | The lowest level written: `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. | the service-logger package |
| `LOG_FORMAT` | unset | `terminal` for one readable line per record, `json` for pino's JSON line. Unset picks `terminal` when the output is a terminal and `json` when it is not. | the service-logger package |
| `DATABASE_URL` | unset, `./data/app.db` | The database the tools read. It is read from the directory the server starts in. | `src/data/sqlite/client.ts`, `src/data/pg/client.ts` |
| `OPEN_NOTEBOOK_URL` | unset, notebook tools off | The notebook's address, `http://` or `https://`, with no user or password in it. When the notebook answers at start, eight `notebook_*` tools are added. | `src/notebook/config.ts`, `src/notebook/startup.ts` |
| `OPEN_NOTEBOOK_API_KEY` | unset | The notebook's password, sent to it as a bearer token. Unset for a notebook with no password. | `src/notebook/config.ts` |

## Check it works

Pipe the protocol's first two requests and a `tools/list` into the stdio server:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | bun run mcp
```

It prints two JSON lines on stdout. The first is the `initialize` result, whose `serverInfo` names
`template-service`. The second lists the tools, and it names `service_info`. On stderr it logs the
start lines shown under [Logs and trace ids](#logs-and-trace-ids): `registered MCP tools`, the
notebook line, then `started`. The server exits when the input ends. The same `tools/list` over
HTTP, from a client connected to `/mcp`, gives the same list.

## Turn it off

Over stdio, nothing runs until a client starts it, so there is no process to stop. Remove the
`template-service` entry from `.mcp.json`, or run `claude mcp remove template-service` for a server
added with `claude mcp add`. Over HTTP, stop the terminal with Ctrl-C. Unset `MCP_TRANSPORT`, or set
it to `stdio`, to go back to stdio.

## Troubleshooting

These are the messages the server and its tools print, and what each one means.

At start, a value that is not a transport stops the server with exit code 1:

```text
MCP_TRANSPORT is "HTTP", which is not a transport. Leave it unset or set it to "stdio" for stdio, or set it to "http" for HTTP.
```

The check is exact and case-sensitive, so `HTTP` and a stray space are refused. Fix the line in
`.env`. A blank value is stdio.

Startup logs why the notebook tools are off, as the message of an `info` line, on stderr over
stdio. `LOG_LEVEL=warn` or higher hides it:

```text
notebook tools off: OPEN_NOTEBOOK_URL is not set
```

That line is normal when no notebook is configured. The other reasons name the setting that is
wrong, such as `OPEN_NOTEBOOK_URL must start with http:// or https://`, or
`OPEN_NOTEBOOK_URL must not carry a user or password; put the password in OPEN_NOTEBOOK_API_KEY`.
A notebook that does not answer in time gives `notebook tools off:` followed by the error's own
message. When the tools are on, the line reads `notebook tools on: 8 Open Notebook tools`, and
it adds a warning when the key would travel in clear over plain `http` to another host.

Over HTTP, a port that another program holds does not stop the server. It takes the next free port
and logs a warning, such as:

```text
port 3001 is taken, falling back to 3002; set health.strictPort or HEALTH_PORT_STRICT=true to fail instead
```

The `started` line then names the ports bound, as `url` and `healthUrl`, so point a client at
those. With `PORT_STRICT=true`, or `HEALTH_PORT_STRICT=true` for the health port, a held port
stops the server with exit code 1 instead, and the error line reads
`port 3001 is taken; set health.port to a free port`. Stop the program that holds the port, or set
`PORT` or `HEALTH_PORT` to a free one.

A client that lists no tools, or fails to start the server, usually started it from another
directory. `.env` and `data/app.db` are read from the directory the command runs in. Use the
`--cwd` form above, with the clone's absolute path.

A tool that fails answers `isError: true` with
`{"error": {"name": "<name>", "message": "<message>"}}`. The message is the one the tool's
error gives, and [the logs](#logs-and-trace-ids) show the trace id of the failed call.
