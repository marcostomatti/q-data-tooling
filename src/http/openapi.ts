import type { HttpMethod, RouteSpec } from './route.ts';

import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z, type ZodType } from 'zod';

import { SESSION_COOKIE } from '../auth/cookies.ts';

// `OpenAPIRegistry` names a reusable schema through zod's `.openapi()`, which this call adds. It
// adds that one method and changes nothing a parse does, so the routes and the tools parse as
// before.
extendZodWithOpenApi(z);

/** The OpenAPI document this module builds, as the generator types it. */
export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

/** The name and version the document carries in its `info`. */
export interface OpenApiInfo {
  readonly title: string
  readonly version: string
}

/**
 * One operation the document holds beside the route table's: a fixed route such as `/health` or
 * one of the `/auth` routes, written in the generator's own form with a full OpenAPI path.
 */
export type DocumentedOperation = RouteConfig;

/** One response of a {@link DocumentedOperation}, keyed by its status code. */
export type DocumentedResponse = RouteConfig['responses'][string];

/** The prefix `mountRoutes` mounts every route under; the document names each path with it. */
export const API_PREFIX = '/api';

/**
 * The names of the two credentials the document declares. `bearer` is the
 * `Authorization: Bearer` header `requireApiAccess` reads, holding the `API_KEY` or an API token.
 * `session` is the signed cookie a browser gets when it signs in.
 */
export const SECURITY = { bearer: 'bearer', session: 'session' } as const;

/** The security of a `/api` route: the bearer credential, or a signed-in browser's cookie. */
export const API_SECURITY: NonNullable<RouteConfig['security']> = [{ [SECURITY.bearer]: [] }, { [SECURITY.session]: [] }];

/** The name the failure envelope is registered under, and the reference every failure uses. */
const ERROR_ENVELOPE = 'ErrorEnvelope';
const ERROR_ENVELOPE_REF = { $ref: `#/components/schemas/${ERROR_ENVELOPE}` };

/** The methods whose fields, beside the path's, travel in the query string and not in a body. */
const QUERY_METHODS: ReadonlySet<HttpMethod> = new Set(['get', 'delete']);

/**
 * The failure every route answers through `sendInputError` and `sendFailure` in `handler.ts`:
 * `{ success: false, error: { name, message } }`. It is registered once and every operation names
 * it by `$ref`.
 */
const ErrorEnvelopeSchema = z.strictObject({
  success: z.literal(false),
  error: z.strictObject({ name: z.string(), message: z.string() }),
});

/**
 * The success envelope the routes answer: `{ success: true, data }`, `data` being `output`.
 *
 * @param output - The schema of `data`.
 * @returns The envelope's schema.
 */
export const successEnvelope = (output: ZodType): ZodType => z.strictObject({ success: z.literal(true), data: output });

/**
 * A JSON response holding the success envelope around `output`.
 *
 * @param description - What the status means for this operation.
 * @param output - The schema of the envelope's `data`.
 * @returns The response, to key by its status.
 */
export const successResponse = (description: string, output: ZodType): DocumentedResponse => ({
  description,
  content: { 'application/json': { schema: successEnvelope(output) } },
});

/**
 * A JSON response holding the failure envelope, `{ success: false, error: { name, message } }`.
 *
 * @param description - What the status means for this operation.
 * @returns The response, to key by its status.
 */
export const failureResponse = (description: string): DocumentedResponse => ({
  description,
  content: { 'application/json': { schema: ERROR_ENVELOPE_REF } },
});

/**
 * One `:name` parameter of an Express 5 path. A name starts with a letter, `_` or `$` and goes on
 * with those and digits, as path-to-regexp 8 reads it, so `:item_id` and `:rev2` are whole names.
 */
const PATH_PARAMETER = /:([A-Za-z_$][\w$]*)/g;

/** The parameter names an Express path declares, in order: `/lists/:listId/entries/:entryId` is both. */
const pathNames = (path: string): readonly string[] => [...path.matchAll(PATH_PARAMETER)].map(([, name]) => name ?? '');

/** The OpenAPI spelling of an Express path: `/items/:itemId` is `/items/{itemId}`. */
const openApiPath = (path: string): string => path.replace(PATH_PARAMETER, '{$1}');

/**
 * Express 5's optional segment, `{/:id}`, and its wildcard, `*rest`. OpenAPI has no spelling for
 * either, so a path holding one is refused rather than documented as a different path.
 */
const UNSPLITTABLE = /[{}*]/;

/** The tag that groups an operation: the first segment of its path, so `/items/:itemId` is `items`. */
const tagOf = (path: string): string => path.split('/').find((segment) => segment !== '') ?? 'root';

/** A route's label as a reader and an error message name it: `GET /items/:itemId`. */
const labelOf = (spec: RouteSpec): string => `${spec.method.toUpperCase()} ${spec.path}`;

/** The three places a route's input arrives from, each a strict object of the fields it holds. */
interface RequestParts {
  readonly params: z.ZodObject
  readonly query: z.ZodObject
  readonly body: z.ZodObject
}

/**
 * Splits a route's input into where each field travels, the way `jsonHandler` merges them back:
 * a field the path names is a path parameter, and every other field is a query parameter on a
 * GET or a DELETE and a body field otherwise. The path-only parameters join the path parameters.
 *
 * `route.ts` requires a path parameter to be named after its schema field, which is what makes
 * this split mechanical. An input that is not an object has no fields to split, so it is refused
 * here, at build time, naming the route.
 */
function requestParts(spec: RouteSpec): RequestParts {
  const { input, pathOnly } = spec.docs;
  if (!(input instanceof z.ZodObject)) throw new Error(`${labelOf(spec)}: its input schema is not an object, so its fields cannot be documented`);
  if (UNSPLITTABLE.test(spec.path)) throw new Error(`${labelOf(spec)}: an optional segment or a wildcard has no OpenAPI spelling`);
  const inPath = new Set(pathNames(spec.path));
  const fields = Object.entries(input.shape as Record<string, ZodType>);
  const named = Object.fromEntries(fields.filter(([name]) => inPath.has(name)));
  const rest = Object.fromEntries(fields.filter(([name]) => !inPath.has(name)));
  // The route matches only when the path holds the segment, so every path parameter is required.
  const params = z.strictObject({ ...named, ...pathOnly }).required();
  return QUERY_METHODS.has(spec.method)
    ? { params, query: z.strictObject(rest), body: z.strictObject({}) }
    : { params, query: z.strictObject({}), body: z.strictObject(rest) };
}

/**
 * The request half of an operation: only the parts that hold a field, so an empty body is no
 * body. A body is required when one of its fields is, because `jsonHandler` reads a missing body
 * as no fields.
 */
function requestOf(parts: RequestParts): RouteConfig['request'] {
  const has = (part: z.ZodObject): boolean => Object.keys(part.shape).length > 0;
  const bodyRequired = Object.values(parts.body.shape as Record<string, ZodType>).some((field) => !field.safeParse(undefined).success);
  return {
    ...(has(parts.params)
      ? { params: parts.params }
      : {}),
    ...(has(parts.query)
      ? { query: parts.query }
      : {}),
    ...(has(parts.body)
      ? { body: { required: bodyRequired, content: { 'application/json': { schema: parts.body } } } }
      : {}),
  };
}

/**
 * One operation of the document, read from one route. A write also documents the 403 a
 * signed-in browser gets without the CSRF header, which a bearer credential never needs.
 */
function operationOf(spec: RouteSpec): RouteConfig {
  return {
    method: spec.method,
    path: `${API_PREFIX}${openApiPath(spec.path)}`,
    summary: spec.docs.summary,
    tags: [tagOf(spec.path)],
    security: API_SECURITY,
    request: requestOf(requestParts(spec)),
    responses: {
      200: successResponse('The route answered.', spec.docs.output),
      400: failureResponse('The input was refused; the message names the field.'),
      401: failureResponse('No credential, or a wrong one, was sent.'),
      ...(spec.method === 'get'
        ? {}
        : { 403: failureResponse('A signed-in browser sent a write without the `x-app-csrf: 1` header.') }),
      500: failureResponse('The work failed inside the service; the message says nothing more.'),
    },
  };
}

/**
 * Builds the OpenAPI 3.1 document for `routes`, read from the route table itself: each operation
 * takes its input from the very schema the route's handler parses, its output from the route's
 * contract, and its summary from the route. Nothing is written a second time for the document, so
 * a route added to `ROUTES` is documented by being added. The fixed routes outside the table,
 * `/health`, the docs and `/auth`, come in as `fixed`, already in the generator's form.
 *
 * @param routes - The route table, `ROUTES` in `src/routes/http.ts` for the served document.
 * @param info - The service's name and version.
 * @param fixed - The operations to add beside the route table's, each with its full path.
 * @returns The document, ready to answer as JSON.
 * @throws {Error} If a route's input schema is not an object, or its path holds an optional
 *   segment or a wildcard; the message names the route.
 */
export function buildOpenApiDocument(routes: readonly RouteSpec[], info: OpenApiInfo, fixed: readonly DocumentedOperation[] = []): OpenApiDocument {
  const definitions = new OpenAPIRegistry();
  definitions.register(ERROR_ENVELOPE, ErrorEnvelopeSchema);
  definitions.registerComponent('securitySchemes', SECURITY.bearer, { type: 'http', scheme: 'bearer' });
  definitions.registerComponent('securitySchemes', SECURITY.session, { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE });
  for (const operation of fixed) definitions.registerPath(operation);
  for (const spec of routes) definitions.registerPath(operationOf(spec));
  return new OpenApiGeneratorV31(definitions.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: info.title, version: info.version },
  });
}

/** What the chassis's `/health` answers: `ok`, or `error` when a dependency such as the database failed. */
const HealthSchema = z.strictObject({ status: z.enum(['ok', 'error']) });

/**
 * `GET /health`, which the service-express chassis serves outside `/api` with no credential, for
 * a load balancer or a container check. It answers its own shape, not the success envelope.
 */
export const HEALTH_OPERATION: DocumentedOperation = {
  method: 'get',
  path: '/health',
  summary: 'Whether the service and its database are up. Needs no credential.',
  tags: ['health'],
  security: [],
  responses: {
    200: { description: 'Every dependency is up.', content: { 'application/json': { schema: HealthSchema } } },
    503: { description: 'A dependency failed; `status` is `error`.', content: { 'application/json': { schema: HealthSchema } } },
  },
};
