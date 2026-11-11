import { DIALECT } from '../../data/active.ts';
import { route } from '../../http/route.ts';
import { inDomain } from '../../logging.ts';

import { DOMAIN, InfoInputSchema, ServiceInfoSchema } from './contract.ts';
import { getServiceInfo } from './get.flow.ts';

/**
 * `GET /api/info`, the HTTP twin of the `service_info` tool: the same schema object and the same
 * flow, answered as `{ success: true, data: ServiceInfo }`. It never reads the database. It binds
 * the `Info` domain on the request's log and hands it to the flow, and logs nothing itself.
 */
export const infoRoute = route('get', '/info', 'service_info', InfoInputSchema, {
  summary: 'The service id, name and version, its database dialect, and whether the Open Notebook tools are configured.',
  output: ServiceInfoSchema,
}, async (input, { log }) => getServiceInfo(input, { env: process.env, dialect: DIALECT, log: inDomain(log, DOMAIN) }));
