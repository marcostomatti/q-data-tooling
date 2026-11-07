# Open Notebook

This page covers Open Notebook, an optional companion that runs beside the service and keeps the
long text the service's tables should not hold. Nothing in the service needs it: the two run side by
side, and an agent, or you, moves text between them. [Setup](setup.md) gets the service running
first, and its [configuration](setup.md#configuration) table lists every variable this page uses.

## What it is and when to turn it on

[Open Notebook](https://github.com/lfnovo/open-notebook) is a self-hosted, open-source alternative
to Google's NotebookLM, under the MIT licence. You group documents into notebooks, and it lets you
search them and ask questions about them, with answers that cite the passage they came from.

- **Sources** can be pasted text, PDFs, web pages, Office documents, audio and video.
- **Search** is both full-text and by meaning: each source is cut into chunks and turned into
  embeddings, numbers that let it find a passage that says the same thing in other words.
- **Chat** answers from the sources you allow it to see, with citations.
- **Notes, transformations and podcasts** are there too: your own notes, AI summaries of a source,
  and generated audio discussions of a notebook.
- **AI providers** are your choice, local (Ollama, LM Studio) or hosted (Anthropic, OpenAI, Google,
  Mistral and others), and you can pick a different one per task.
- It runs in Docker with a SurrealDB database, serves its UI on port `8502` and a REST API on port
  `5055`, with interactive API docs at `/docs`.

Turn it on when a session needs to ask questions of reading material the service does not store as
rows, or when an agent should file long text beside the rows it records. A service that only holds
rows does not need it. With it on, the service's MCP server adds eight `notebook_*` tools, so an
agent drives both through one server.

### What each one keeps

The service holds the facts you filter, count and decide on. The notebook holds the long text you
read and ask questions of. A useful test: if you would sort or count it, it belongs in the service's
tables; if you would read it or ask about it, it belongs in a notebook. A short summary column in
the service can stand for a long source in the notebook, so a query stays fast while the full text
is still one search away.

### What you gain by running both

- **The service stays fast and structured.** Long text does not sit in its queries, and its schema
  does not grow a column for every kind of document.
- **Questions over everything you collected,** with the passage each answer came from, which is how
  you check an AI answer instead of trusting it.
- **Both stay on your machine,** if you choose local models. Nothing needs a hosted service.
- **One agent can drive both** through the service's MCP server: it records rows with the service's
  own tools and files the long text with the `notebook_*` tools.

### What it does not do

- **It is not the record.** It holds reading material; the service's database holds the facts.
- **The two are not linked in the database.** No service table points at a notebook or a source. Any
  link is a naming convention, such as a source title, which you choose.
- **Sources are copies.** Editing a file after uploading it does not change the notebook. Upload it
  again, or the notebook answers from the old version.
- **It does not fetch documents for you.** Open Notebook only stores what it is given.
- **It is single-user.** There are no accounts or per-user permissions.

### What it costs you, and what to watch

- **Another stack to run.** Docker, the Open Notebook container and SurrealDB, next to the service's
  own database. Updates, backups and disk space are yours to manage; the service's `bun run backup`
  does not cover it.
- **Compute for embeddings.** Every source is embedded when it is added. A local embedding model is
  light, but it is one more model to keep running.
- **Where your text goes depends on the models you pick.** With a hosted provider, the text you
  embed, and the passages a chat question retrieves, are sent to that provider. With local models it
  stays on your machine. You can mix them: a local embedding model keeps every source local, and
  only questions plus the passages they retrieve reach a hosted chat model. Some hosted providers
  have no embedding models at all (Anthropic is one), so embeddings need a second provider or a
  local model either way.
- **It is open by default.** Upstream's compose file publishes the UI and the API on every network
  interface with no password. This repository's `docker-compose.notebook.yaml` binds every port to
  `127.0.0.1`, but it still starts without a password: set one before you store anything personal in
  it.

### The notebook tools

With `OPEN_NOTEBOOK_URL` set, the MCP server asks the notebook for one authenticated read when it
starts. If the notebook answers, eight tools are added; if it is not set, unreachable, or refuses
the key, none is added and the server writes one line to stderr saying why, such as `notebook tools
off: OPEN_NOTEBOOK_URL is not set`. The line never holds the URL or the key.

| Tool | What it does |
|---|---|
| `notebook_list`, `notebook_create` | List notebooks, or create one |
| `notebook_source_list` | List stored documents, without their text, 100 a page |
| `notebook_source_get` | Read one document's text, in windows of up to 200,000 characters |
| `notebook_source_add_text` | Store pasted text, embedded for meaning search by default |
| `notebook_source_delete` | Delete one document; the only tool marked destructive |
| `notebook_search` | Search documents and notes, by words or by meaning |
| `notebook_note_add` | Add a note in the user's words |

These tools are enough to run Open Notebook as a container with no UI: the MCP server is then its
only door. None of them reads or writes the service's own database. A source is a copy, so to
replace one the agent stores the new text and deletes the older copy with `notebook_source_delete`
once the new copy reads back.

If the notebook stops answering after startup, its tools stay listed and each call fails with
`NotebookUnavailableError`; the next call tries again, so a notebook that comes back is used again
without a restart. A call waits at most 15 seconds. A refused key is a `NotebookRequestError` naming
`OPEN_NOTEBOOK_API_KEY`, and an unknown id is a `NotFoundError`.

### Calling the REST API directly

These calls were checked against Open Notebook's API version 0.1.0. They load the variables from
step 1 of [setup from zero](#setup-from-zero) first.

```bash
set -a; . ./.env; set +a
AUTH="Authorization: Bearer $OPEN_NOTEBOOK_API_KEY"
```

Create a notebook; the response carries its `id`:

```bash
curl -s -X POST "$OPEN_NOTEBOOK_URL/api/notebooks" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name": "Acme", "description": "Research on Acme"}'
```

Add pasted text as a source, embedded so it can be searched:

```bash
curl -s -X POST "$OPEN_NOTEBOOK_URL/api/sources/json" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"type": "text", "title": "acme/annual report", "content": "…the document text…",
       "notebooks": ["notebook:…"], "embed": true, "async_processing": true}'
```

Processing runs in the background. `GET /api/sources/{id}/status` says `completed` when the text is
stored, and embedding finishes a little later: `GET /api/sources/{id}` reports `"embedded": true`
and a non-zero `embedded_chunks` once the source can be searched.

### Keeping the two in step

- **Title a source with the key the service stores for the row it belongs to**, and a notebook with
  the name the service uses for the same thing, so you can find one from the other.
- **Upload again after an edit**, and delete the old source, so a question cannot be answered from a
  version you replaced.
- **Treat the service as the record.** If the two disagree about a date or a decision, the service
  is right; the notebook holds reading material.

## Setup from zero

1. **Set its secrets** in this repository's `.env`, which git ignores and which Docker Compose reads
   from the same directory. If the file is not there yet, copy `.env.example` as
   [setup](setup.md#create-env) says.

   ```bash
   OPEN_NOTEBOOK_ENCRYPTION_KEY=a-long-random-string
   OPEN_NOTEBOOK_URL=http://localhost:5055
   OPEN_NOTEBOOK_API_KEY=the-password-you-choose
   ```

   The encryption key encrypts the provider keys the notebook stores. `OPEN_NOTEBOOK_API_KEY` is
   used twice: the compose file passes it to the notebook as its `OPEN_NOTEBOOK_PASSWORD`, and the
   MCP server sends it as the bearer token, so the two cannot drift apart. The API takes the
   password as a bearer token; with one set, every `/api/...` route answers 401 without it. Left
   unset, the notebook has no password and the default encryption key `change-me-template-service`.
2. **Start it** with the compose file at the root of this repository:

   ```bash
   docker compose -f docker-compose.notebook.yaml up -d
   ```

   It runs the `open-notebook` and `surrealdb` services as the Compose project
   `template-service-notebook`, separate from the Postgres in `docker-compose.yaml`. The UI is at
   `http://127.0.0.1:8502` and the API at `http://127.0.0.1:5055`; SurrealDB listens on
   `127.0.0.1:8000` for debugging only. Every port is bound to `127.0.0.1`, and neither service
   restarts on its own (`restart: "no"`), so start it again after a reboot. The ports can be moved
   with `OPEN_NOTEBOOK_UI_PORT`, `OPEN_NOTEBOOK_API_PORT` and `SURREAL_PORT`, and SurrealDB's
   credentials, `root` and `root` by default, with `SURREAL_USER` and `SURREAL_PASSWORD`. The data
   lives in two named volumes; [turn it off](#turn-it-off) says how to delete them.
3. **Add two models** in its UI: one embedding model and one language model. An embedding model from
   Ollama keeps every source on your machine.

## Configuration

These are the notebook rows of the [configuration table](setup.md#configuration), with the same
meaning. Set them in `.env`: the compose file and the service both read it.

| Variable | Default | What it does | Read by |
| --- | --- | --- | --- |
| `OPEN_NOTEBOOK_URL` | unset, notebook tools off | The notebook's address, `http://` or `https://`, with no user or password in it. When the notebook answers at start, eight `notebook_*` tools are added. | `src/notebook/config.ts`, `src/notebook/startup.ts` |
| `OPEN_NOTEBOOK_API_KEY` | unset | The notebook's password, sent to it as a bearer token. Unset for a notebook with no password. | `src/notebook/config.ts`, `docker-compose.notebook.yaml` |
| `OPEN_NOTEBOOK_ENCRYPTION_KEY` | `change-me-template-service` | Compose only. The key that encrypts the provider keys the notebook stores. Set your own. | `docker-compose.notebook.yaml` |
| `OPEN_NOTEBOOK_UI_PORT` | `8502` | Compose only. The host port of the notebook's web UI. | `docker-compose.notebook.yaml` |
| `OPEN_NOTEBOOK_API_PORT` | `5055` | Compose only. The host port of the notebook's REST API. | `docker-compose.notebook.yaml` |
| `SURREAL_USER` | `root` | Compose only. The user of the SurrealDB database the notebook stores into. | `docker-compose.notebook.yaml` |
| `SURREAL_PASSWORD` | `root` | Compose only. Its password. Change it before storing anything in the notebook. | `docker-compose.notebook.yaml` |
| `SURREAL_PORT` | `8000` | Compose only. The host port of SurrealDB, for local debugging. | `docker-compose.notebook.yaml` |

## Check it works

With the notebook running and `OPEN_NOTEBOOK_URL` set in `.env`, start the MCP server on an empty
input:

```sh
printf '' | bun run mcp
```

It exits as soon as the input ends. On stderr it prints `notebook tools on: 8 Open Notebook tools`,
which means the startup read reached the notebook and the key was accepted. A line that starts with
`notebook tools off:` names the reason instead; the [troubleshooting](#troubleshooting) section
lists them.

## Turn it off

1. Stop the two containers. Their data stays in the volumes, so the next `up -d` finds it:

   ```sh
   docker compose -f docker-compose.notebook.yaml down
   ```

2. In `.env`, remove the `OPEN_NOTEBOOK_URL` line or leave it blank, so the MCP server stops asking
   for a notebook at start.

To delete the notebook's data as well, run the same command with `-v`. It removes both volumes and
everything in them, the notebook's sources included:

```sh
docker compose -f docker-compose.notebook.yaml down -v
```

The service's own database is not touched by either command.

## Troubleshooting

Each message is quoted as the code prints it. The first group comes at start, on stderr, and the
last group comes back in a tool result.

When no notebook is configured, the server starts with the tools off:

```text
notebook tools off: OPEN_NOTEBOOK_URL is not set
```

That line is normal. The other start-up reasons name the setting that is wrong:

```text
notebook tools off: OPEN_NOTEBOOK_URL is not a URL
notebook tools off: OPEN_NOTEBOOK_URL must start with http:// or https://
notebook tools off: OPEN_NOTEBOOK_URL must not carry a user or password; put the password in OPEN_NOTEBOOK_API_KEY
```

Fix the line in `.env`. A notebook that is not running, or an `OPEN_NOTEBOOK_URL` with the wrong
port, gives this:

```text
notebook tools off: the notebook is unavailable: the connection failed
```

Start it with the compose command in [setup from zero](#setup-from-zero), and check that the port in
`OPEN_NOTEBOOK_URL` matches `OPEN_NOTEBOOK_API_PORT`. A notebook that does not answer within 3
seconds gives `notebook tools off:` followed by its own reason.

A wrong key is found at start too:

```text
notebook tools off: the notebook refused the key (401); check OPEN_NOTEBOOK_API_KEY
```

A 403 reads the same way. Make `OPEN_NOTEBOOK_API_KEY` in `.env` the password the notebook was
started with, then run `docker compose -f docker-compose.notebook.yaml up -d` again so the notebook
is recreated with it.

When the tools are on and the URL is plain `http` to a host other than this machine, the line on
start ends with `; warning: the key is sent over plain http to a host that is not this machine`. Use
an `https://` address for that host, or keep the notebook on this machine.

During use, a tool call that fails returns `isError: true` with the error's message, as described in
[MCP](mcp.md#the-tools). The three messages are these:

- `NotebookUnavailableError` means the notebook stopped answering after start. Its tools stay
  listed; start the notebook again, and the next call retries without a restart of the server.
- `NotebookRequestError` naming `OPEN_NOTEBOOK_API_KEY` means the key was refused, as in the 401
  line above.
- `NotFoundError` means the id the call named is not in the notebook.
