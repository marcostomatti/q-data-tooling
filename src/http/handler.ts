import type { Db } from '../data/repositories/db.ts';
import type { Request, RequestHandler, Response } from 'express';

import { randomUUID } from 'node:crypto';

import { isTraceId } from '@open-tomato/service';
import { z, ZodError, type ZodType } from 'zod';

import { describeError, statusFor } from '../errors.ts';
import { isRecord } from '../guards.ts';
import { inDomain, lazyLogger, scoped, TRACE_ID_FIELD, type Log } from '../logging.ts';

const STATUS_BAD_REQUEST = 400;
const STATUS_INTERNAL = 500;

/** The request and response header that carries a request's trace id. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** The name a caller sees on a refused request, which says the input was at fault. */
const VALIDATION_ERROR_NAME = 'ValidationError';

/** Schemas, by name, for path parameters that locate a resource but are not part of any tool's input. */
export type PathOnlySchemas = Readonly<Record<string, ZodType>>;

/** What `run` receives for those parameters: each one parsed with its own schema. */
export type PathOnlyValues<P extends PathOnlySchemas> = { readonly [K in keyof P]: z.infer<P[K]> };

/**
 * What a route's `run` receives beside its parsed input: the database, the log of the request,
 * and the path parameters its tool's schema does not name, each parsed on its own schema.
 */
export interface RouteRunContext<P extends PathOnlySchemas> {
  readonly db: Db
  readonly log: Log
  readonly pathOnly: PathOnlyValues<P>
}

/** What a route may pass beside its schema and its work. */
export interface JsonHandlerOptions<P extends PathOnlySchemas> {
  /** For a path that carries more than its tool's schema names. */
  readonly pathOnly?: P
  /** The MCP tool the route mirrors, named on its 500 line; `route` sets it, a `webRoute` has none. */
  readonly tool?: string
}

/**
 * The signature of the line a handler writes itself, its 500: domain `Http`, scope `handle` (the
 * handler's own workflow) and step `respond`, so it is never mistaken for a line the flow wrote.
 */
const HANDLER_DOMAIN = 'Http';
const HANDLER_SCOPE = 'handle';

/** The module's own logger, made on first use so importing this file starts no logger. */
const defaultLogger = lazyLogger('http');

/** A refusal of the caller's input that names one field, or the whole request when `field` is absent. */
export function inputError(message: string, field?: string): ZodError {
  return new ZodError([{ code: 'custom', path: field === undefined
    ? []
    : [field], message }]);
}

/**
 * The text a caller reads for a refused request: every issue, led by the field it is about.
 * It is built from each issue's path and message only, never from the received value, so a
 * refusal cannot echo a secret back.
 */
function describeInput(error: ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length === 0
      ? issue.message
      : `${issue.path.map(String).join('.')}: ${issue.message}`))
    .join('; ');
}

/** Answers 400 for input the caller got wrong. `describeError` is not used: it flattens a `ZodError`. */
export function sendInputError(res: Response, error: ZodError): void {
  res.status(STATUS_BAD_REQUEST).json({
    success: false,
    error: { name: VALIDATION_ERROR_NAME, message: describeInput(error) },
  });
}

/**
 * Answers for an error thrown while doing the work, never while reading the request. The status
 * is `statusFor`'s and the text is `describeError`'s, which is also what the MCP surface sends, so
 * the two cannot word one failure differently. A 500 is logged on `log`, the module's own logger
 * when none is given, as `fields` with the error beside them as `err`.
 *
 * A `ZodError` is the exception to `statusFor`: out here it can only have come from inside the
 * server (a parse of stored data, say), because the request was already parsed, so it is a 500
 * with the flat text. `statusFor` maps it to 400 for the benefit of a caller's own bad input,
 * and answering 400 with "internal error" beside it would blame the caller for the server.
 */
export function sendFailure(res: Response, error: unknown, log?: Log, fields: object = {}): void {
  const status = error instanceof ZodError
    ? STATUS_INTERNAL
    : statusFor(error);
  if (status >= STATUS_INTERNAL) (log ?? defaultLogger()).error({ ...fields, err: error }, 'request failed');
  res.status(status).json({ success: false, error: describeError(error) });
}

/**
 * The one object a schema parses: the path's parameters, the query and the body, in that order.
 *
 * That order alone lets a body field overwrite a path parameter of the same name, which would let
 * `PATCH /items/5` with a body naming item 9 change item 9 under a URL that says 5. So a name
 * claimed by the path may not also arrive in the query or the body; that is a 400 naming the field,
 * and nothing is overwritten. Between the query and the body, which the path does not name, the
 * body wins, as the order says.
 */
function mergeInput(req: Request, withheld: ReadonlySet<string>): Record<string, unknown> {
  const body: unknown = req.body;
  if (body !== undefined && !isRecord(body)) throw inputError('the request body must be a JSON object');
  const params = Object.fromEntries(Object.entries(req.params).filter(([name]) => !withheld.has(name)));
  const others = { ...req.query, ...body };
  for (const name of Object.keys(params)) {
    if (name in others) throw inputError('is named by the path and must not also be sent in the query or body', name);
  }
  return { ...params, ...others };
}

/**
 * The trace id of a request: its `x-request-id` when the core's `isTraceId` takes it, 1 to 64
 * characters from `[A-Za-z0-9._:-]` so a header cannot write a control character or a long string
 * into the logs, otherwise a new UUID. A header sent more than once arrives joined by `, `, which
 * is refused. The chassis picks its `req.id` by the same rule, so the two cannot drift.
 */
export function traceIdFor(header: unknown): string {
  return isTraceId(header)
    ? header
    : randomUUID();
}

/**
 * The request's trace id, answered in the response's `x-request-id` so a caller can quote the id
 * its lines carry. Behind the chassis that is the id the chassis already picked by the same rule,
 * `req.id`, which its `request completed` line carries too; without the chassis (a route test on
 * a bare app) it is `traceIdFor` over the header. Returns the id, for the request's log to bind.
 */
export function answerTraceId(req: Request, res: Response): string {
  const chassisId: unknown = req.id;
  const traceId = isTraceId(chassisId)
    ? chassisId
    : traceIdFor(req.headers[REQUEST_ID_HEADER]);
  res.setHeader(REQUEST_ID_HEADER, traceId);
  return traceId;
}

/** The path parameters the tool's schema does not name, parsed on schemas of their own. */
function parsePathOnly<P extends PathOnlySchemas>(req: Request, schemas: P | undefined): PathOnlyValues<P> {
  if (schemas === undefined) return {} as PathOnlyValues<P>;
  const raw = Object.fromEntries(Object.keys(schemas).map((name) => [name, req.params[name]]));
  return z.strictObject(schemas).parse(raw) as PathOnlyValues<P>;
}

/**
 * Adapts a tool's input schema and work to an Express handler. It parses
 * `{ ...req.params, ...req.query, ...req.body }` with the very schema object the MCP tool
 * registers, so a route and its tool cannot disagree about what a valid request is, then calls
 * `run` and answers `{ success: true, data }`.
 *
 * A request the schema refuses is a 400 naming the field, and `run` is never called, so the
 * data layer is not reached. This is the opposite of the MCP envelope, which treats a
 * `ZodError` as internal because the SDK has already validated: here this function is the
 * validator, so a `ZodError` from the parse is the caller's.
 *
 * Every request gets a trace id from `answerTraceId`, the chassis's `req.id` or else its
 * `x-request-id`, and the response answers it in `x-request-id`, on success, 400 and 500 alike,
 * so a caller can quote it.
 *
 * `run` receives one context object, `{ db, log, pathOnly }`. `db` is a parameter so that `run`
 * holds no way to obtain a database of its own and a test can hand it any. `log` is a child of the
 * base log the handler is built with, binding the request's `traceId`: it is handed to `run` as it
 * is, for the route to bind its own domain on. A 500 is logged on a child of it that binds domain
 * `Http` and scope `handle`, as `{ step: 'respond', tool, err }` with the error's detail, which the
 * caller never sees, so the failure line shares the id of the lines the flow wrote and still
 * carries a full signature. `tool` is `options.tool`, a field of that one line and never a binding,
 * left out for a `webRoute`.
 *
 * `options.pathOnly` is for a path that names more than the tool's schema does (the list in
 * `/lists/:listId/entries/:entryId`): those parameters are withheld from the strict parse, parsed
 * on their own schemas, and handed to `run` as `pathOnly`.
 */
export function jsonHandler<S extends ZodType, P extends PathOnlySchemas = Record<never, ZodType>>(
  schema: S,
  run: (args: z.infer<S>, context: RouteRunContext<P>) => Promise<unknown>,
  db: Db,
  log: Log,
  options?: JsonHandlerOptions<P>,
): RequestHandler {
  const withheld = new Set(Object.keys(options?.pathOnly ?? {}));
  const failed = options?.tool === undefined
    ? { step: 'respond' }
    : { step: 'respond', tool: options.tool };
  return async (req, res): Promise<void> => {
    const traced = log.child({ [TRACE_ID_FIELD]: answerTraceId(req, res) });
    const fail = (error: unknown): void => sendFailure(res, error, scoped(inDomain(traced, HANDLER_DOMAIN), HANDLER_SCOPE), failed);
    let args: z.infer<S>;
    let pathOnly: PathOnlyValues<P>;
    try {
      const parsed = schema.safeParse(mergeInput(req, withheld));
      if (!parsed.success) return sendInputError(res, parsed.error);
      args = parsed.data;
      pathOnly = parsePathOnly(req, options?.pathOnly);
    } catch (error: unknown) {
      if (error instanceof ZodError) return sendInputError(res, error);
      return fail(error);
    }
    try {
      const data = await run(args, { db, log: traced, pathOnly });
      res.json({ success: true, data: data === undefined
        ? null
        : data });
    } catch (error: unknown) {
      fail(error);
    }
  };
}
