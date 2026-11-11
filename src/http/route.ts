import type { Db } from '../data/repositories/db.ts';
import type { Log } from '../logging.ts';
import type { RequestHandler } from 'express';
import type { z, ZodType } from 'zod';

import { jsonHandler, type JsonHandlerOptions, type PathOnlySchemas, type RouteRunContext } from './handler.ts';

/** The Express router verbs a route may use; each is a method of `Router` that `mountRoutes` calls. */
export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

/**
 * One route, as data, so a test can read the table that is mounted and not a copy of it.
 *
 * `path` is relative to `/api`. Its parameters are named after the fields of the tool's schema
 * (`:itemId`, not `:id`), because the schema is strict and a parameter it does not name would
 * be refused. A client cannot see a parameter's name, only the URL, so `/items/:itemId`
 * and `/items/:id` are the same route to it.
 *
 * `tools` and `schemas` run in step: `schemas[i]` is the very input schema object of the MCP tool
 * named `tools[i]`. A route that serves more than one tool lists each.
 *
 * `handler` builds the Express handler over the database and the base log `mountRoutes` is given.
 *
 * `docs` is what the OpenAPI document (`src/http/openapi.ts`) reads of the route: the very schema
 * the handler parses, the path parameters it parses on their own, the output, and a summary.
 */
export interface RouteSpec {
  readonly method: HttpMethod
  readonly path: string
  readonly tools: readonly string[]
  readonly schemas: readonly ZodType[]
  readonly handler: (db: Db, log: Log) => RequestHandler
  readonly docs: RouteDocs
}

/**
 * What a route states about itself for its documentation, beside its schema and its work: a one
 * line summary, and the schema of the `data` its success answers, which is the output schema in
 * its route folder's `contract.ts`. Both are required, so a route without them fails typecheck.
 */
export interface RouteDescription {
  readonly summary: string
  readonly output: ZodType
}

/** A route's description with what the route itself parses: its input and its path-only parameters. */
export interface RouteDocs extends RouteDescription {
  readonly input: ZodType
  readonly pathOnly: PathOnlySchemas
}

/** What a `webRoute`'s `run` receives beside its parsed input: the database and the request's log. */
export interface WebRunContext {
  readonly db: Db
  readonly log: Log
}

/**
 * A route only the web app needs, which mirrors no MCP tool, so it lists none. It still parses
 * with a strict schema from its route's `contract.ts`, exactly as `route()` does; the schema is
 * not listed in `schemas`, because that list names tool inputs and runs in step with `tools`. It
 * is still documented: `description` gives its summary and output schema, as `route()`'s does.
 */
export function webRoute<S extends ZodType>(
  method: HttpMethod,
  path: string,
  schema: S,
  description: RouteDescription,
  run: (args: z.infer<S>, context: WebRunContext) => Promise<unknown>,
): RouteSpec {
  return {
    method,
    path,
    tools: [],
    schemas: [],
    handler: (db, log) => jsonHandler(schema, run, db, log),
    docs: { ...description, input: schema, pathOnly: {} },
  };
}

/**
 * A route that mirrors exactly one tool: the tool's schema, and the work its `run` does. `run`
 * receives `{ db, log, pathOnly }`, `pathOnly` holding the parameters `options.pathOnly` names.
 * Its 500 line names `tool`. `description` is its summary and output schema, for the OpenAPI
 * document.
 */
export function route<S extends ZodType, P extends PathOnlySchemas = Record<never, ZodType>>(
  method: HttpMethod,
  path: string,
  tool: string,
  schema: S,
  description: RouteDescription,
  run: (args: z.infer<S>, context: RouteRunContext<P>) => Promise<unknown>,
  options?: Pick<JsonHandlerOptions<P>, 'pathOnly'>,
): RouteSpec {
  return {
    method,
    path,
    tools: [tool],
    schemas: [schema],
    handler: (db, log) => jsonHandler(schema, run, db, log, { ...options, tool }),
    docs: { ...description, input: schema, pathOnly: options?.pathOnly ?? {} },
  };
}
