import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { buildOpenApiDocument, type OpenApiDocument } from '../../src/http/openapi.ts';
import { route, webRoute, type RouteSpec } from '../../src/http/route.ts';
import { ROUTES } from '../../src/routes/http.ts';

/** Made up for this file: the document's name and version, which a test reads back. */
const INFO = { title: 'Probe service', version: '9.9.9' };

const nothing = async (): Promise<null> => null;

/** The OpenAPI spelling of an Express path: `/items/:itemId` is `/items/{itemId}`. */
const openApiPath = (path: string): string => path.replace(/:([A-Za-z_$][\w$]*)/g, '{$1}');

/** The one operation a document holds for `method` and `path`, or a failure naming both. */
function operation(document: OpenApiDocument, method: string, path: string): Record<string, unknown> {
  const item: unknown = document.paths?.[path]?.[method as 'get'];
  if (item === undefined) throw new Error(`the document has no ${method.toUpperCase()} ${path}`);
  return item as Record<string, unknown>;
}

/** Builds the document over the given routes alone. */
const documentOf = (...routes: RouteSpec[]): OpenApiDocument => buildOpenApiDocument(routes, INFO);

describe('the OpenAPI document', () => {
  test('is OpenAPI 3.1, names the service and its version, and serves every path under /api', () => {
    const document = documentOf();

    expect(document.openapi).toStartWith('3.1');
    expect(document.info).toMatchObject(INFO);
    expect(document.servers).toEqual([{ url: '/api' }]);
  });

  test('holds one operation for every route in ROUTES, and none that ROUTES lacks', () => {
    const document = buildOpenApiDocument(ROUTES, INFO);

    const documented = Object.entries(document.paths ?? {}).flatMap(([path, item]) => Object.keys(item ?? {}).map((method) => `${method.toUpperCase()} ${path}`));
    const routed = ROUTES.map((spec) => `${spec.method.toUpperCase()} ${openApiPath(spec.path)}`);

    // Named labels, not counts: a renamed route keeps the count and changes a label.
    expect(documented.toSorted()).toEqual(routed.toSorted());
  });

  test('a field the path names is a path parameter, and a GET\'s other fields are query parameters', () => {
    const spec = route('get', '/items/:itemId', 'item_get', z.strictObject({ itemId: z.string(), q: z.string().optional() }), {
      summary: 'Reads one item.',
      output: z.strictObject({ id: z.string() }),
    }, nothing);

    const read = operation(documentOf(spec), 'get', '/items/{itemId}');

    expect(read['parameters']).toEqual([
      expect.objectContaining({ in: 'path', name: 'itemId', required: true }),
      expect.objectContaining({ in: 'query', name: 'q', required: false }),
    ]);
    expect(read['requestBody']).toBeUndefined();
  });

  test('a write\'s other fields are its JSON body, which does not repeat the path parameter', () => {
    const spec = route('patch', '/items/:itemId', 'item_update', z.strictObject({ itemId: z.string(), name: z.string() }), {
      summary: 'Renames one item.',
      output: z.strictObject({ id: z.string(), name: z.string() }),
    }, nothing);

    const update = operation(documentOf(spec), 'patch', '/items/{itemId}');

    expect(update['parameters']).toEqual([expect.objectContaining({ in: 'path', name: 'itemId', required: true })]);
    expect(update['requestBody']).toMatchObject({
      required: true,
      content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
    });
    const body = update['requestBody'] as { content: { 'application/json': { schema: { properties: object } } } };
    expect(Object.keys(body.content['application/json'].schema.properties)).toEqual(['name']);
  });

  test('a path parameter the tool schema leaves to pathOnly is documented as a path parameter too', () => {
    const spec = route('delete', '/lists/:listId/entries/:entryId', 'entry_delete', z.strictObject({ entryId: z.string() }), {
      summary: 'Removes one entry from a list.',
      output: z.strictObject({ removed: z.boolean() }),
    }, nothing, { pathOnly: { listId: z.string() } });

    const remove = operation(documentOf(spec), 'delete', '/lists/{listId}/entries/{entryId}');

    expect(remove['parameters']).toEqual([
      expect.objectContaining({ in: 'path', name: 'entryId', required: true }),
      expect.objectContaining({ in: 'path', name: 'listId', required: true }),
    ]);
  });

  test('answers a route\'s output inside the success envelope, and every refusal as the error envelope', () => {
    const document = buildOpenApiDocument(ROUTES, INFO);

    const info = operation(document, 'get', '/info');
    const responses = info['responses'] as Record<string, { content: { 'application/json': { schema: unknown } } }>;

    expect(responses['200']?.content['application/json'].schema).toMatchObject({
      type: 'object',
      required: ['success', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' }, dialect: { enum: ['sqlite', 'pg'] }, notebook: { type: 'boolean' } },
        },
      },
    });
    for (const status of ['400', '401', '500']) {
      expect({ status, schema: responses[status]?.content['application/json'].schema })
        .toEqual({ status, schema: { $ref: '#/components/schemas/ErrorEnvelope' } });
    }
    expect(document.components?.schemas?.['ErrorEnvelope']).toMatchObject({
      type: 'object',
      properties: { success: { enum: [false] }, error: { type: 'object', required: ['name', 'message'] } },
    });
  });

  test('takes each operation\'s summary from its route and its tag from the path\'s first segment', () => {
    const spec = webRoute('post', '/widgets/:widgetId/archive', z.strictObject({ widgetId: z.string() }), {
      summary: 'Archives one widget.',
      output: z.strictObject({ archived: z.boolean() }),
    }, nothing);

    const archive = operation(documentOf(spec), 'post', '/widgets/{widgetId}/archive');

    expect(archive['summary']).toBe('Archives one widget.');
    expect(archive['tags']).toEqual(['widgets']);
  });

  test('declares the bearer credential the /api check reads, and requires it on every operation', () => {
    const document = buildOpenApiDocument(ROUTES, INFO);

    expect(document.components?.securitySchemes?.['bearer']).toEqual({ type: 'http', scheme: 'bearer' });
    for (const spec of ROUTES) {
      expect(operation(document, spec.method, openApiPath(spec.path))['security']).toEqual([{ bearer: [] }]);
    }
  });

  test('reads a parameter name with digits, underscores or a dollar sign, as Express 5 does', () => {
    const spec = route('get', '/items/:item_id/v:rev2', 'item_rev', z.strictObject({ item_id: z.string(), rev2: z.string() }), {
      summary: 'Reads one revision of an item.',
      output: z.strictObject({ id: z.string() }),
    }, nothing);

    const read = operation(documentOf(spec), 'get', '/items/{item_id}/v{rev2}');

    expect(read['parameters']).toEqual([
      expect.objectContaining({ in: 'path', name: 'item_id', required: true }),
      expect.objectContaining({ in: 'path', name: 'rev2', required: true }),
    ]);
  });

  test('documents a path parameter as required even when its field is optional, since the path holds it', () => {
    const spec = route('get', '/things/:thingId', 'thing_get', z.strictObject({ thingId: z.string().optional() }), {
      summary: 'Reads one thing.',
      output: z.strictObject({ id: z.string() }),
    }, nothing);

    const read = operation(documentOf(spec), 'get', '/things/{thingId}');

    expect(read['parameters']).toEqual([expect.objectContaining({ in: 'path', name: 'thingId', required: true })]);
  });

  test('marks a body required only when one of its fields is', () => {
    const optional = route('patch', '/notes/:noteId', 'note_update', z.strictObject({ noteId: z.string(), text: z.string().optional() }), {
      summary: 'Edits one note.',
      output: z.strictObject({ id: z.string() }),
    }, nothing);
    const required = route('post', '/notes', 'note_create', z.strictObject({ text: z.string() }), {
      summary: 'Creates one note.',
      output: z.strictObject({ id: z.string() }),
    }, nothing);

    const document = documentOf(optional, required);

    expect(operation(document, 'patch', '/notes/{noteId}')['requestBody']).toMatchObject({ required: false });
    expect(operation(document, 'post', '/notes')['requestBody']).toMatchObject({ required: true });
  });

  test('refuses, naming the route, a path with an optional segment or a wildcard it cannot split', () => {
    const optional = webRoute('get', '/files{/:fileId}', z.strictObject({ fileId: z.string().optional() }), { summary: 'Lists files.', output: z.null() }, nothing);
    const wildcard = webRoute('get', '/files/*rest', z.strictObject({ rest: z.string() }), { summary: 'Reads a file.', output: z.null() }, nothing);

    expect(() => documentOf(optional)).toThrow('GET /files{/:fileId}');
    expect(() => documentOf(wildcard)).toThrow('GET /files/*rest');
  });

  test('refuses, naming the route, an input schema that is not an object', () => {
    const odd = webRoute('post', '/odd', z.string(), { summary: 'Takes a bare string.', output: z.null() }, nothing);

    expect(() => documentOf(odd)).toThrow('POST /odd');
  });
});
