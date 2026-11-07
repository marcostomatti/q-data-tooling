import { z } from 'zod';

/**
 * A whole number that may arrive as text, because an HTTP path and query string carry
 * strings while an MCP tool call carries JSON numbers. A union rather than `z.coerce`,
 * so `true` and `''` are refused instead of becoming 1 and 0.
 */
const numberOrNumericText = z.union([z.number(), z.string().regex(/^\d+$/)
  .transform(Number)]);

/**
 * A boolean that may arrive as text, because a query string carries strings while an MCP
 * call carries JSON booleans. Only the two words are accepted, so `1` and `yes` are refused.
 */
export const booleanOrText = z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]);

/** A row's primary key: a positive whole number, however the surface received it. */
export const IdSchema = numberOrNumericText.pipe(z.number().int()
  .positive());
