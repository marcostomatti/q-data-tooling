import { z } from 'zod';

/** The domain every line of `service_info` carries, bound by both its transport files. */
export const DOMAIN = 'Info';

/**
 * The input of `service_info`: nothing. Strict, so a stray field or query parameter is a 400 on
 * the HTTP surface and a refusal on the MCP one, rather than being silently dropped.
 */
export const InfoInputSchema = z.strictObject({});

export type InfoInput = z.infer<typeof InfoInputSchema>;

/**
 * What `service_info` answers: the service's id and name from `APP`, its `package.json` version,
 * the active database dialect, and whether the Open Notebook tools are configured.
 */
export const ServiceInfoSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  dialect: z.enum(['sqlite', 'pg']),
  notebook: z.boolean(),
});

export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;
