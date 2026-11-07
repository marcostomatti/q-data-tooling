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
 */
export interface RouteSpec {
  readonly method: HttpMethod
  readonly path: string
  readonly tools: readonly string[]
  readonly schemas: readonly ZodType[]
  readonly handler: (db: Db, log: Log) => RequestHandler
}

/** What a `webRoute`'s `run` receives beside its parsed input: the database and the request's log. */
export interface WebRunContext {
  readonly db: Db
  readonly log: Log
}

/**
 * A route only the web app needs, which mirrors no MCP tool, so it lists none. It still parses
 * with a strict schema from its route's `contract.ts`, exactly as `route()` does; the schema is
 * not listed in `schemas`, because that list names tool inputs and runs in step with `tools`.
 */
export function webRoute<S extends ZodType>(
  method: HttpMethod,
  path: string,
  schema: S,
  run: (args: z.infer<S>, context: WebRunContext) => Promise<unknown>,
): RouteSpec {
  return { method, path, tools: [], schemas: [], handler: (db, log) => jsonHandler(schema, run, db, log) };
}

/**
 * A route that mirrors exactly one tool: the tool's schema, and the work its `run` does. `run`
 * receives `{ db, log, pathOnly }`, `pathOnly` holding the parameters `options.pathOnly` names.
 * Its 500 line names `tool`.
 */
export function route<S extends ZodType, P extends PathOnlySchemas = Record<never, ZodType>>(
  method: HttpMethod,
  path: string,
  tool: string,
  schema: S,
  run: (args: z.infer<S>, context: RouteRunContext<P>) => Promise<unknown>,
  options?: Pick<JsonHandlerOptions<P>, 'pathOnly'>,
): RouteSpec {
  return {
    method,
    path,
    tools: [tool],
    schemas: [schema],
    handler: (db, log) => jsonHandler(schema, run, db, log, { ...options, tool }),
  };
}
