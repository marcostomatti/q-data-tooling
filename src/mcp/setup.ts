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
  /**
   * The base log, the package's logger in `server.ts`, which writes to stderr on stdio and to
   * stdout over HTTP. The start lines bind `Mcp` and `start` on it, and each tool call logs on a
   * child of it.
   */
  readonly log: Log
}

/**
 * Registers `tools` on `server`, each call logging on `log`, and reports how many on `log`, under
 * domain `Mcp` and scope `start`, with steps `register` and `addNotebook`. On stdio stdout is the
 * protocol channel, and the package's logger already writes to stderr there, so the same lines
 * are safe on both transports.
 */
export function setupMcp(server: McpServer, setup: McpSetup): void {
  registerTools(server, setup.db, setup.tools, setup.log);
  const { notebook, tools } = setup;
  const log = scoped(inDomain(setup.log, DOMAIN), 'start');
  log.info({ step: 'register', tools: tools.length }, 'registered MCP tools');
  if (notebook) log.info({ step: 'addNotebook', notebookTools: notebook.tools.length }, notebook.message);
}
