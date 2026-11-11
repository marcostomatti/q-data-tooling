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

/** The page size a list returns when the caller names none. */
export const PAGE_SIZE_DEFAULT = 25;

/** The largest page size a list accepts; a larger `pageSize` is refused, not clamped. */
export const PAGE_SIZE_MAX = 100;

/**
 * The paging fields of a list's query: `page` from 1 and `pageSize` from 1 to
 * {@link PAGE_SIZE_MAX}, each a number or its digits, defaulting to 1 and
 * {@link PAGE_SIZE_DEFAULT}. Strict, so a stray field is refused.
 */
export const PaginationQuery = z.strictObject({
  /** The page to return, from 1. */
  page: numberOrNumericText.pipe(z.number().int()
    .min(1)).default(1),
  /** The most items one page holds, from 1 to {@link PAGE_SIZE_MAX}. */
  pageSize: numberOrNumericText.pipe(z.number().int()
    .min(1)
    .max(PAGE_SIZE_MAX)).default(PAGE_SIZE_DEFAULT),
});

/**
 * Builds the `data` part of a paged list response: one page of items with the paging
 * fields and the total count across every page. The template wraps it as
 * `{ success: true, data }`.
 *
 * @param item - The schema of one item on the page.
 * @returns A strict schema of `{ items, page, pageSize, total }`.
 */
export const pageOf = <T extends z.ZodType>(item: T) => z.strictObject({
  /** The items on this page. */
  items: z.array(item),
  /** The page returned, as asked for. */
  page: z.number().int(),
  /** The page size asked for. */
  pageSize: z.number().int(),
  /** The count of matching items across every page. */
  total: z.number().int(),
});

/**
 * A stock ticker: 1 to 10 letters, digits, dots or dashes, in either case, returned
 * upper case so `brk.b` and `BRK.B` name the same company.
 */
export const Ticker = z.string().regex(/^[A-Za-z0-9.-]{1,10}$/)
  .transform((t) => t.toUpperCase());
