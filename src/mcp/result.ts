import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { describeError } from '../errors.ts';

/**
 * Wraps a value as the successful result of a tool call: one text block of JSON.
 *
 * `JSON.stringify(undefined)` returns `undefined` rather than a string, and a text block needs a
 * string, so a tool that returns nothing sends `null`. A value JSON cannot hold, such as a
 * `BigInt` or a cycle, makes `JSON.stringify` throw; that throw is left to the caller, because
 * `registerTools` runs this inside the same `try` as the tool and turns it into an
 * `errorResult`. Swallowing it here would send a caller a success that is not one.
 */
export function okResult(value: unknown): CallToolResult {
  const text = JSON.stringify(value) ?? 'null';
  return { content: [{ type: 'text', text }] };
}

/** Turns anything a tool threw into an error result carrying `describeError`'s text. */
export function errorResult(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: describeError(error) }) }],
  };
}
