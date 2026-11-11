import { createMCP } from '@open-tomato/service-mcp';

import { APP } from '../app-config.ts';
import { getDb } from '../data/active.ts';
import { notebookStartup } from '../notebook/startup.ts';
import { ALL_TOOLS } from '../routes/tools.ts';
import { createSecClient } from '../sec/client.ts';
import { readSecUserAgent } from '../sec/config.ts';

import { setupMcp } from './setup.ts';
import { applyTransport } from './transport.ts';

// Run it, never import it: createMCP starts on call and exits the process if setup throws.
// The package treats every MCP_TRANSPORT value except exactly 'stdio' as HTTP, so the value is
// checked and normalised here first: unset or blank is stdio, 'http' opts in, anything else exits.
const transport = applyTransport(process.env, {
  write: (text) => void process.stderr.write(text),
  exit: (code) => process.exit(code),
});

/** The checked SEC User-Agent, or the start stopped with the reason on stderr. */
function secUserAgent(): string {
  try {
    return readSecUserAgent(process.env);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error
      ? error.message
      : String(error)}\n`);
    return process.exit(1);
  }
}

// The SEC User-Agent is read before anything opens, as `serve` reads it: without it no filings
// sync could succeed, so a missing or unusable value stops the start with its own message. The
// one client is shared by every client's tools, so its spacing covers every call.
const sec = createSecClient({ fetch, userAgent: secUserAgent() });

// The Open Notebook tools exist only when a notebook is configured and answers now, so the
// probe runs before the server starts. Unset, it returns at once and costs nothing.
const notebook = transport === undefined
  ? undefined
  : await notebookStartup(process.env);
const tools = [...ALL_TOOLS, ...(notebook?.tools ?? [])];

// Over HTTP `setup` runs once per connecting client, and once at startup under stdio, so
// everything a process must do once happens here and reaches `setup` by closure. The database
// opens now, so a bad DATABASE_URL stops the start instead of failing each client's setup.
const db = getDb();

createMCP({
  serviceId: APP.id,
  setup: (server, { logger }) => {
    setupMcp(server, {
      db,
      tools,
      notebook,
      // Undefined only once `applyTransport` has exited the process; the package reads it as HTTP.
      transport: transport ?? 'http',
      log: logger,
      sec,
    });
  },
});
