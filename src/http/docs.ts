import type { DocumentedOperation, OpenApiDocument } from './openapi.ts';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Router } from 'express';
import { z } from 'zod';

import { API_SECURITY, failureResponse } from './openapi.ts';

/**
 * The folder of the installed `swagger-ui-dist`, resolved from its `package.json` so the files
 * are read from wherever the package manager put it.
 */
const SWAGGER_UI_DIR = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/package.json')));

/**
 * The only files of the package the page loads. Each is served by name, so the package's demo
 * page and its petstore initializer, which it ships beside them, are never reachable.
 */
const SWAGGER_UI_FILES = ['swagger-ui-bundle.js', 'swagger-ui.css'] as const;

/**
 * The page's start-up script, served as a file of its own: helmet's default content security
 * policy, which the chassis sets, runs a script from this origin and refuses an inline one. The
 * online validator is off, because it would send the document to a third-party host.
 */
const initScript = (documentUrl: string): string => `window.ui = SwaggerUIBundle({
  url: '${documentUrl}',
  dom_id: '#swagger-ui',
  deepLinking: true,
  validatorUrl: null,
});
`;

/** The docs page: Swagger UI's stylesheet, its bundle and the start-up script, all from `docsPath`. */
const docsPage = (docsPath: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API docs</title>
<link rel="stylesheet" href="${docsPath}/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${docsPath}/swagger-ui-bundle.js"></script>
<script src="${docsPath}/init.js"></script>
</body>
</html>
`;

/**
 * The router that serves the API's own documentation: `GET /openapi.json` answers `document`,
 * and `GET /docs` answers a Swagger UI page that reads it. `mountRoutes` mounts it under `/api`,
 * behind `requireApiAccess`, so the docs need the same credential as the routes they describe.
 * A signed-in browser carries its session cookie, so the web app's user can open the page.
 *
 * @param document - The document to serve, built once when the routes are mounted.
 * @param prefix - Where the router is mounted, which the page's links and the script's URL name.
 * @returns The router, to mount at `prefix`.
 */
export function docsRouter(document: OpenApiDocument, prefix: string): Router {
  const router = Router();
  const docsPath = `${prefix}/docs`;
  const page = docsPage(docsPath);
  const script = initScript(`${prefix}/openapi.json`);
  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.get('/docs', (_req, res) => {
    res.type('html').send(page);
  });
  router.get('/docs/init.js', (_req, res) => {
    res.type('js').send(script);
  });
  for (const file of SWAGGER_UI_FILES) {
    router.get(`/docs/${file}`, (_req, res) => {
      res.sendFile(file, { root: SWAGGER_UI_DIR });
    });
  }
  return router;
}

/**
 * The two routes {@link docsRouter} serves that a reader calls, as document operations: the
 * document itself and the page. The page's own files are left out, since only the page loads them.
 *
 * @param prefix - Where the router is mounted, `/api` for the served document.
 * @returns The two operations, with their full paths.
 */
export function docsOperations(prefix: string): readonly DocumentedOperation[] {
  const unauthorized = failureResponse('No credential, or a wrong one, was sent.');
  return [
    {
      method: 'get',
      path: `${prefix}/openapi.json`,
      summary: 'This OpenAPI document, as JSON.',
      tags: ['docs'],
      security: API_SECURITY,
      responses: {
        200: { description: 'The document.', content: { 'application/json': { schema: z.looseObject({ openapi: z.string() }) } } },
        401: unauthorized,
      },
    },
    {
      method: 'get',
      path: `${prefix}/docs`,
      summary: 'A Swagger UI page that reads this document.',
      tags: ['docs'],
      security: API_SECURITY,
      responses: {
        200: { description: 'The page.', content: { 'text/html': { schema: z.string() } } },
        401: unauthorized,
      },
    },
  ];
}
