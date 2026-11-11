import type { ToolDefinition } from '../mcp/register.ts';

import { infoTool } from './info/tool.ts';

/**
 * Every MCP tool the service always offers: `service_info`, the reference tool a new one copies.
 * The Open Notebook tools are added beside these by `src/mcp/server.ts` when a notebook is
 * configured and answers at startup.
 *
 * This file only assembles the arrays and starts nothing, so a test can import it. The entry
 * point that starts the server is `src/mcp/server.ts`, which no test imports.
 */
export const ALL_TOOLS: readonly ToolDefinition[] = [infoTool];
