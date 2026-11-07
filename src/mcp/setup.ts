/**
 * The work `createMCP`'s `setup` does in `src/mcp/server.ts`, kept here so a test can run it:
 * that entry point starts the server when it is imported, and no test imports it.
 *
 * @module
 */

import type { McpTransport } from './transport.ts';
import type { Db } from '../data/repositories/db.ts';
import type { NotebookStartup } from '../notebook/startup.ts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { inDomain, scoped, type Log } from '../logging.ts';

import { registerTools, type ToolDefinition } from './register.ts';

/** The domain the MCP server's start lines carry. */
const DOMAIN = 'Mcp';

/** What {@link setupMcp} registers and where it reports the count. */
export interface McpSetup {
  readonly db: Db
  readonly tools: readonly ToolDefinition[]
  /** The notebook probe's outcome, or `undefined` when none ran. */
  readonly notebook: NotebookStartup | undefined
  readonly transport: McpTransport
  /** The base log, the package's logger in `server.ts`; the start lines bind `Mcp` and `start` on it. */
  readonly log: Log
  /** Writes one line to stderr; used in stdio mode, where the log writes to the protocol channel. */
  readonly writeStderr: (text: string) => void
}

/**
 * Registers `tools` on `server` and reports how many. On stdio, stdout is the protocol channel
 * and the package's logger writes to it, so a log line there would corrupt the stream: the count
 * and the notebook message go to stderr as plain text. Over HTTP they are logged on `log`, under
 * domain `Mcp` and scope `start`, with steps `register` and `addNotebook`.
 */
export function setupMcp(server: McpServer, setup: McpSetup): void {
  registerTools(server, setup.db, setup.tools);
  const { notebook, tools } = setup;
  if (setup.transport === 'stdio') {
    setup.writeStderr(`registered ${tools.length} MCP tools\n`);
    if (notebook) setup.writeStderr(`${notebook.message}\n`);
    return;
  }
  const log = scoped(inDomain(setup.log, DOMAIN), 'start');
  log.info({ step: 'register', tools: tools.length }, 'registered MCP tools');
  if (notebook) log.info({ step: 'addNotebook', notebookTools: notebook.tools.length }, notebook.message);
}
