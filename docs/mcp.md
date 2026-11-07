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
  that is set, on every network interface. Nothing authenticates it either: anyone who reaches the
  port can call every tool, writes included. Use it only behind a firewall that admits loopback
  alone, or behind your own proxy.

### The tools

`ALL_TOOLS` in `src/routes/tools.ts` lists the tools every server offers. It holds one today:

| Tool | Title | What it returns |
| --- | --- | --- |
| `service_info` | Service info | The service id, name and version, the database dialect (`sqlite` or `pg`) and whether the notebook tools are on. It takes no arguments and only reads. |

When `OPEN_NOTEBOOK_URL` is set and the notebook answers at startup, `src/mcp/server.ts` adds eight
more after `service_info`. They are the [Open Notebook](open-notebook.md) tools:

- `notebook_list` and `notebook_create` list and create notebooks.
- `notebook_source_list`, `notebook_source_get`, `notebook_source_add_text` and
  `notebook_source_delete` work on the sources of one notebook.
- `notebook_search` searches a notebook, and `notebook_note_add` adds a note to one.

A successful call returns one text block of JSON. A failed call returns `isError: true` with one
text block, `{"error": "<the message>"}`. A new tool is added by `/be create-route`, which
[the skills page](skills.md) describes, and the tool is listed in `ALL_TOOLS` in the same change.

### Logs and trace ids

Over stdio, stdout carries the protocol, so the server's own log lines go to stderr. Each line is
one pino-shaped JSON object, filtered by `LOG_LEVEL`. The two start lines are plain text on stderr:

```text
registered 1 MCP tools
notebook tools off: OPEN_NOTEBOOK_URL is not set
```

Each tool call gets a new `traceId`, a random UUID, and every line written while that call runs
carries it. Two calls never share one. The MCP route does not read the caller's `x-request-id`,
unlike the HTTP routes. `service_info` writes one debug line, so its trace id shows only at
`LOG_LEVEL=debug` or lower:

```json
{"level":20,"service":"mcp","traceId":"92d566d1-0961-443d-a56c-85642c92cda8","domain":"Info","scope":"get","step":"read","dialect":"sqlite","notebook":false,"msg":"service info read"}
```

One exception breaks the rule. The package that starts the server writes its own lines through the
same pino logger, to stdout: `Shutting down MCP server...` and `Shutdown complete` when the server
stops, and `Failed to start MCP server` when setup fails. They are JSON, but not JSON-RPC, so a
client should skip any stdout line that is not a JSON-RPC message. Over HTTP, stdout is free and
the start lines go there too, under domain `Mcp` and scope `start`.

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

Point a client at `http://localhost:8080/mcp`. For Claude Code:

```sh
claude mcp add --transport http template-service http://localhost:8080/mcp
```

The transport is Streamable HTTP and stateful. A client's `initialize` gets a session id, which the
client sends on its later requests. The server keeps one session per start, so a second client,
or a client after a disconnect, needs a restart of the server.

The package also starts a health endpoint at `http://localhost:3001/health`. Its port is always
3001: `PORT` moves the MCP port and leaves that one where it is.

## Configuration

These are the MCP rows of the [configuration table](setup.md#configuration), with the same meaning.

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `MCP_TRANSPORT` | unset, stdio | `stdio` or unset for stdio. Only the exact value `http` opts in to HTTP. Any other value exits 1 at start. | `src/mcp/transport.ts`, `src/mcp/server.ts` |
| `PORT` | `8080` for MCP over HTTP | The port of the MCP HTTP transport. A whole number from 1 to 65535. It does not move the health port. | the service-mcp package |
| `LOG_LEVEL` | `info` | The lowest level written: `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. | `src/logging.ts`, the service-express package |
| `DATABASE_URL` | unset, `./data/app.db` | The database the tools read. It is read from the directory the server starts in. | `src/data/sqlite/client.ts`, `src/data/pg/client.ts` |
| `OPEN_NOTEBOOK_URL` | unset, notebook tools off | The notebook's address, `http://` or `https://`, with no user or password in it. When the notebook answers at start, eight `notebook_*` tools are added. | `src/notebook/config.ts`, `src/notebook/startup.ts` |
| `OPEN_NOTEBOOK_API_KEY` | unset | The notebook's password, sent to it as a bearer token. Unset for a notebook with no password. | `src/notebook/config.ts` |

## Check it works

Pipe the protocol's first two requests and a `tools/list` into the stdio server:

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | bun run mcp
```

It prints two JSON lines on stdout. The first is the `initialize` result, whose `serverInfo` names
`template-service`. The second lists the tools, and it names `service_info`. On stderr it prints
`registered 1 MCP tools`, plus the notebook line. The server exits when the input ends. The same
`tools/list` over HTTP, from a client connected to `/mcp`, gives the same list.

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

Startup says why the notebook tools are off, on stderr:

```text
notebook tools off: OPEN_NOTEBOOK_URL is not set
```

That line is normal when no notebook is configured. The other reasons name the setting that is
wrong, such as `OPEN_NOTEBOOK_URL must start with http:// or https://`, or
`OPEN_NOTEBOOK_URL must not carry a user or password; put the password in OPEN_NOTEBOOK_API_KEY`.
A notebook that does not answer in time gives `notebook tools off:` followed by the error's own
message. When the tools are on, the line reads `notebook tools on: 8 Open Notebook tools`, and
it adds a warning when the key would travel in clear over plain `http` to another host.

Over HTTP, a health port 3001 that another program holds stops the server. Bun prints:

```text
error: Failed to start server. Is port 3001 in use?
```

Port 3001 is the health port, and `PORT` does not change it. Stop the program that holds it, then
start the server again.

A client that lists no tools, or fails to start the server, usually started it from another
directory. `.env` and `data/app.db` are read from the directory the command runs in. Use the
`--cwd` form above, with the clone's absolute path.

A tool that fails answers `isError: true` with `{"error": "<message>"}`. The message is the one the
tool's error gives, and [the logs](#logs-and-trace-ids) show the trace id of the failed call. Over
stdio, a stdout line that is not JSON-RPC is the shutdown line described above, not a fault in a
tool.
