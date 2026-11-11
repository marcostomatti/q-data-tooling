import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { buildOpenApiDocument, type OpenApiDocument } from '../../src/http/openapi.ts';
import { route, webRoute, type RouteSpec } from '../../src/http/route.ts';
import { ROUTES, serviceDocument } from '../../src/routes/http.ts';

/** Made up for this file: the document's name and version, which a test reads back. */
const INFO = { title: 'Probe service', version: '9.9.9' };

const nothing = async (): Promise<null> => null;

/** The document's path for a route in the table: `/items/:itemId` is `/api/items/{itemId}`. */
const openApiPath = (path: string): string => `/api${path.replace(/:([A-Za-z_$][\w$]*)/g, '{$1}')}`;

/** The one operation a document holds for `method` and `path`, or a failure naming both. */
function operation(document: OpenApiDocument, method: string, path: string): Record<string, unknown> {
  const item: unknown = document.paths?.[path]?.[method as 'get'];
  if (item === undefined) throw new Error(`the document has no ${method.toUpperCase()} ${path}`);
  return item as Record<string, unknown>;
}

/** Builds the document over the given routes alone. */
const documentOf = (...routes: RouteSpec[]): OpenApiDocument => buildOpenApiDocument(routes, INFO);

describe('the OpenAPI document', () => {
  test('is OpenAPI 3.1, names the service and its version, and spells each route\'s path under /api', () => {
    const spec = webRoute('get', '/widgets', z.strictObject({}), { summary: 'Lists widgets.', output: z.null() }, nothing);

    const document = documentOf(spec);

    expect(document.openapi).toStartWith('3.1');
    expect(document.info).toMatchObject(INFO);
    expect(document.servers).toBeUndefined();
    expect(Object.keys(document.paths ?? {})).toEqual(['/api/widgets']);
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

    const read = operation(documentOf(spec), 'get', '/api/items/{itemId}');

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

    const update = operation(documentOf(spec), 'patch', '/api/items/{itemId}');

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

    const remove = operation(documentOf(spec), 'delete', '/api/lists/{listId}/entries/{entryId}');

    expect(remove['parameters']).toEqual([
      expect.objectContaining({ in: 'path', name: 'entryId', required: true }),
      expect.objectContaining({ in: 'path', name: 'listId', required: true }),
    ]);
  });

  test('answers a route\'s output inside the success envelope, and every refusal as the error envelope', () => {
    const document = buildOpenApiDocument(ROUTES, INFO);

    const info = operation(document, 'get', '/api/info');
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

    const archive = operation(documentOf(spec), 'post', '/api/widgets/{widgetId}/archive');

    expect(archive['summary']).toBe('Archives one widget.');
    expect(archive['tags']).toEqual(['widgets']);
  });

  test('declares the two credentials the /api check reads, and takes either on every route', () => {
    const document = buildOpenApiDocument(ROUTES, INFO);

    expect(document.components?.securitySchemes?.['bearer']).toEqual({ type: 'http', scheme: 'bearer' });
    expect(document.components?.securitySchemes?.['session']).toEqual({ type: 'apiKey', in: 'cookie', name: 'template-service_session' });
    for (const spec of ROUTES) {
      expect(operation(document, spec.method, openApiPath(spec.path))['security']).toEqual([{ bearer: [] }, { session: [] }]);
    }
  });

  test('documents the 403 a signed-in browser\'s write gets without the CSRF header, and none on a read', () => {
    const read = webRoute('get', '/notes', z.strictObject({}), { summary: 'Lists notes.', output: z.null() }, nothing);
    const write = webRoute('post', '/notes', z.strictObject({ text: z.string() }), { summary: 'Creates a note.', output: z.null() }, nothing);

    const document = documentOf(read, write);

    expect(Object.keys(operation(document, 'get', '/api/notes')['responses'] as object)).not.toContain('403');
    expect(Object.keys(operation(document, 'post', '/api/notes')['responses'] as object)).toContain('403');
  });

  test('reads a parameter name with digits, underscores or a dollar sign, as Express 5 does', () => {
    const spec = route('get', '/items/:item_id/v:rev2', 'item_rev', z.strictObject({ item_id: z.string(), rev2: z.string() }), {
      summary: 'Reads one revision of an item.',
      output: z.strictObject({ id: z.string() }),
    }, nothing);

    const read = operation(documentOf(spec), 'get', '/api/items/{item_id}/v{rev2}');

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

    const read = operation(documentOf(spec), 'get', '/api/things/{thingId}');

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

    expect(operation(document, 'patch', '/api/notes/{noteId}')['requestBody']).toMatchObject({ required: false });
    expect(operation(document, 'post', '/api/notes')['requestBody']).toMatchObject({ required: true });
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

/** Every operation of a document, as `METHOD /path` labels. */
const labels = (document: OpenApiDocument): string[] => Object.entries(document.paths ?? {})
  .flatMap(([path, item]) => Object.keys(item ?? {}).map((method) => `${method.toUpperCase()} ${path}`));

describe('the served document', () => {
  test('lists the health check, with no credential and its own shape', () => {
    const health = operation(serviceDocument('none'), 'get', '/health');

    expect(health['security']).toEqual([]);
    expect(Object.keys(health['responses'] as object)).toEqual(['200', '503']);
  });

  test('lists the document and the docs page under /api, behind the /api credentials', () => {
    const document = serviceDocument('none');

    for (const path of ['/api/openapi.json', '/api/docs']) {
      expect({ path, security: operation(document, 'get', path)['security'] }).toEqual({ path, security: [{ bearer: [] }, { session: [] }] });
    }
  });

  test('lists only the /auth routes each sign-in mode serves', () => {
    const authOf = (mode: 'none' | 'password' | 'oidc'): string[] => labels(serviceDocument(mode)).filter((label) => label.includes(' /auth/'))
      .toSorted();
    const session = ['GET /auth/session', 'POST /auth/logout'];
    const tokens = ['GET /auth/tokens', 'POST /auth/tokens', 'DELETE /auth/tokens/{id}'];

    expect(authOf('none')).toEqual(session.toSorted());
    expect(authOf('password')).toEqual([...session, 'POST /auth/login', ...tokens].toSorted());
    expect(authOf('oidc')).toEqual([...session, 'GET /auth/oidc/start', 'GET /auth/oidc/callback', ...tokens].toSorted());
  });

  test('asks the CSRF header on every unsafe /auth route, and a session alone on the token routes', () => {
    const document = serviceDocument('password');

    const login = operation(document, 'post', '/auth/login');
    expect(login['parameters']).toEqual([expect.objectContaining({ in: 'header', name: 'x-app-csrf', required: true })]);
    expect(login['requestBody']).toMatchObject({ required: true, content: { 'application/json': { schema: { properties: { password: { type: 'string' } } } } } });
    for (const [method, path] of [['get', '/auth/tokens'], ['post', '/auth/tokens'], ['delete', '/auth/tokens/{id}']] as const) {
      expect({ method, path, security: operation(document, method, path)['security'] }).toEqual({ method, path, security: [{ session: [] }] });
    }
  });

  test('answers a new token with 201 and the token, and an unknown token id with 404', () => {
    const document = serviceDocument('password');

    const create = operation(document, 'post', '/auth/tokens')['responses'] as Record<string, unknown>;
    const revoke = operation(document, 'delete', '/auth/tokens/{id}')['responses'] as Record<string, unknown>;

    expect(create['201']).toMatchObject({ content: { 'application/json': { schema: { properties: { data: { required: ['token', 'summary'] } } } } } });
    expect(Object.keys(revoke)).toContain('404');
  });
});
