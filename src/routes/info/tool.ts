import { DIALECT } from '../../data/active.ts';
import { inDomain } from '../../logging.ts';
import { defineTool, type ToolDefinition } from '../../mcp/register.ts';

import { DOMAIN, InfoInputSchema } from './contract.ts';
import { getServiceInfo } from './get.flow.ts';

/**
 * The reference tool: the pattern a new tool copies. It takes no input, touches no table, and
 * its HTTP twin (`src/routes/info/http.ts`) parses with the very same `InfoInputSchema` object.
 * It binds the `Info` domain on the call's log and hands it to the flow, and logs nothing itself.
 */
export const infoTool: ToolDefinition = defineTool({
  name: 'service_info',
  title: 'Service info',
  description:
    'Returns the service id, name and version, the database dialect it runs on (sqlite or pg), ' +
    'and whether the Open Notebook tools are configured. Takes no arguments.',
  input: InfoInputSchema,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (input, { log }) => getServiceInfo(input, { env: process.env, dialect: DIALECT, log: inDomain(log, DOMAIN) }),
});
