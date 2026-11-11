
import type { AuthMode } from '../auth/contract.ts';
import type { Db } from '../data/repositories/db.ts';
import type { OpenApiDocument } from '../http/openapi.ts';
import type { RouteSpec } from '../http/route.ts';

import { Router, type Application } from 'express';

import packageJson from '../../package.json' with { type: 'json' };
import { APP } from '../app-config.ts';
import { authOperations } from '../auth/openapi.ts';
import { docsOperations, docsRouter } from '../http/docs.ts';
import { API_PREFIX, buildOpenApiDocument, HEALTH_OPERATION } from '../http/openapi.ts';
import { lazyLogger, type Log } from '../logging.ts';

import { companyRoutes } from './companies/http.ts';
import { filingRoutes } from './filings/http.ts';
import { infoRoute } from './info/http.ts';

/**
 * Every internal HTTP route, each mounted under `/api`. `service_info` is the reference route a
 * new one copies; a route added here is mounted with it. The companies routes follow it, then
 * the filings routes.
 */
export const ROUTES: readonly RouteSpec[] = [infoRoute, ...companyRoutes, ...filingRoutes];

/**
 * The OpenAPI document the service serves: every route in `ROUTES`, and beside them the fixed
 * routes outside the table, `GET /health`, the docs themselves, and the `/auth` routes that
 * `mode` turns on.
 *
 * @param mode - The sign-in mode, `AUTH_MODE`, which decides the `/auth` routes listed.
 * @returns The document.
 * @throws {Error} If a route in `ROUTES` cannot be documented; the message names it.
 */
export function serviceDocument(mode: AuthMode): OpenApiDocument {
  return buildOpenApiDocument(ROUTES, { title: APP.name, version: packageJson.version }, [
    HEALTH_OPERATION,
    ...authOperations(mode),
    ...docsOperations(API_PREFIX),
  ]);
}

/**
 * Mounts every route under `/api`, and beside them the API's documentation from `docsRouter`:
 * `GET /api/openapi.json`, built once here by {@link serviceDocument}, and the Swagger UI page
 * `GET /api/docs`. Building the document here means a route it cannot describe stops the start
 * with its name.
 *
 * No credential check is mounted here. The server entry mounts `requireApiAccess` on `/api`
 * before calling this; a second check in this function would test every request twice.
 *
 * `log` is the base log every route's handler is built with and hands to its `run`; it defaults
 * to the `http` logger, and a test passes a capturing fake. `authMode` is the sign-in mode the
 * document lists the `/auth` routes of; it defaults to `none`, the mode with no sign-in.
 */
export function mountRoutes(app: Application, db: Db, log: Log = lazyLogger('http')(), authMode: AuthMode = 'none'): void {
  const api = Router();
  for (const spec of ROUTES) api[spec.method](spec.path, spec.handler(db, log));
  api.use(docsRouter(serviceDocument(authMode), API_PREFIX));
  app.use(API_PREFIX, api);
}
