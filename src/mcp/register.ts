import type { Db } from '../data/repositories/db.ts';
import type { Log } from '../logging.ts';
import type { SecClient } from '../sec/client.ts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z, ZodType } from 'zod';

import { randomUUID } from 'node:crypto';

import { TRACE_ID_FIELD } from '../logging.ts';

import { errorResult, okResult } from './result.ts';

/**
 * What a tool's `run` receives beside its parsed input: the database, the call's log, a child of
 * the base log bound to that call's own `traceId`, and the SEC client the server built, which is
 * absent when the tools were registered without one.
 */
export interface ToolRunContext {
  readonly db: Db
  readonly log: Log
  readonly sec?: SecClient
}

/**
 * The one shape every tool module exports: a name, the words a client shows, the Zod schema
 * of its input, and the function that does the work.
 *
 * `input` is a plain Zod schema with nothing MCP-specific in it, so the HTTP route that mirrors
 * the tool can parse with the same object. `run` takes `unknown` here because a list of
 * definitions mixes schemas; `defineTool` is the one place that ties its argument type to `input`.
 */
export interface ToolDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly input: ZodType
  /**
   * The SDK's read-only and destructive hints, which a client may use to decide whether a call
   * needs explicit approval. Optional, and sent to `registerTool` only when present. Which tools
   * carry which hint is each tool author's call.
   */
  readonly annotations?: ToolAnnotations
  readonly run: (args: unknown, context: ToolRunContext) => Promise<unknown>
}

/** What a tool module passes to `defineTool`: `run` sees the parsed output type of `input`. */
export interface ToolSpec<S extends ZodType> {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly input: S
  readonly annotations?: ToolAnnotations
  readonly run: (args: z.infer<S>, context: ToolRunContext) => Promise<unknown>
}

/**
 * Builds a `ToolDefinition`, typing `run`'s arguments from the schema. The cast to `unknown`
 * is sound because `registerTools` hands `run` only what `input` parsed: the SDK validates a
 * call against the schema before it reaches the handler.
 */
export function defineTool<S extends ZodType>(spec: ToolSpec<S>): ToolDefinition {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: spec.input,
    ...(spec.annotations === undefined
      ? {}
      : { annotations: spec.annotations }),
    run: (args, context) => spec.run(args as z.infer<S>, context),
  };
}

/**
 * Registers every definition on the server, wrapping each `run` so that a thrown error, or a
 * result JSON cannot hold, comes back as an `errorResult` instead of rejecting.
 *
 * This is a plain function over a server it is given, not one that creates a server: the
 * entry point that calls `createMCP` (which starts at once and exits the process when setup
 * throws) is the only place that may, and a test can pass a bare `McpServer`. The SDK throws
 * when two definitions share a name.
 *
 * `log` is the base log, the package's logger through `setupMcp`, which writes to stderr on
 * stdio, where stdout carries the protocol. Each call binds a fresh `crypto.randomUUID()` as
 * `traceId` on a child of it and hands that child to `run` with the database, so every line one
 * call writes carries the same id and no two calls share one. A test passes a capturing fake.
 *
 * `sec` is the SEC client the entry point built once, handed to every `run` as it is, so every
 * call syncs through the one shared client and its request spacing. Left out, `run` receives
 * `undefined` and no tool reaches SEC; a test passes a client over a stub `fetch`.
 *
 * @param server - The server to register on.
 * @param db - The database every `run` is handed.
 * @param definitions - The tools to register.
 * @param log - The base log each call's log is a child of.
 * @param sec - The SEC client every `run` is handed, or `undefined`.
 * @throws When two definitions share a name.
 */
export function registerTools(
  server: McpServer,
  db: Db,
  definitions: readonly ToolDefinition[],
  log: Log,
  sec?: SecClient,
): void {
  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.input,
        ...(definition.annotations === undefined
          ? {}
          : { annotations: definition.annotations }),
      },
      async (args: unknown): Promise<CallToolResult> => {
        const traced = log.child({ [TRACE_ID_FIELD]: randomUUID() });
        try {
          return okResult(await definition.run(args, { db, log: traced, sec }));
        } catch (error: unknown) {
          return errorResult(error);
        }
      },
    );
  }
}
