
import type { Db } from '../data/repositories/db.ts';
import type { RouteSpec } from '../http/route.ts';

import { Router, type Application } from 'express';

import packageJson from '../../package.json' with { type: 'json' };
import { APP } from '../app-config.ts';
import { docsRouter } from '../http/docs.ts';
import { API_PREFIX, buildOpenApiDocument } from '../http/openapi.ts';
import { lazyLogger, type Log } from '../logging.ts';

import { infoRoute } from './info/http.ts';

/**
 * Every internal HTTP route, each mounted under `/api`. `service_info` is the reference route a
 * new one copies; a route added here is mounted with it.
 */
export const ROUTES: readonly RouteSpec[] = [infoRoute];

/**
 * Mounts every route under `/api`, and beside them the API's documentation from `docsRouter`:
 * `GET /api/openapi.json`, built once here from `ROUTES`, and the Swagger UI page `GET /api/docs`.
 * Building the document here means a route it cannot describe stops the start with its name.
 *
 * No credential check is mounted here. The server entry mounts `requireApiAccess` on `/api`
 * before calling this; a second check in this function would test every request twice.
 *
 * `log` is the base log every route's handler is built with and hands to its `run`; it defaults
 * to the `http` logger, and a test passes a capturing fake.
 */
export function mountRoutes(app: Application, db: Db, log: Log = lazyLogger('http')()): void {
  const api = Router();
  for (const spec of ROUTES) api[spec.method](spec.path, spec.handler(db, log));
  api.use(docsRouter(buildOpenApiDocument(ROUTES, { title: APP.name, version: packageJson.version }), API_PREFIX));
  app.use(API_PREFIX, api);
}
