/**
 * The `/api` routes on a bare Express app, mounted in the order `startService` mounts them: the
 * credential check, then the routes. Shared by the docs and info tests, which need no database
 * (`tests/http/`), and the info test that reads the token table (`tests/integration/http/`).
 *
 * @module
 */

import type { Db } from '../../src/data/repositories/db.ts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { requireApiAccess } from '../../src/auth/access.ts';
import { mountRoutes } from '../../src/routes/http.ts';

/** A running `/api` app and its `close()`. */
export interface ApiApp {
  /** Where it listens, as `http://localhost:<port>`. */
  readonly origin: string
  close(): Promise<void>
}

/**
 * A client with no query builder, for a test whose requests read no database: a route that
 * reads it anyway throws a TypeError, and the test sees a 500 in place of the status it expects.
 */
export const NO_DATABASE = {} as unknown as Db;

/**
 * Mounts `requireApiAccess` and the routes on `/api` and listens on a port the OS picks.
 *
 * @param db - The database the credential check and the routes read.
 * @param apiKey - The key the credential check takes.
 * @returns The running app.
 */
export async function startApiApp(db: Db, apiKey: string): Promise<ApiApp> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', requireApiAccess(db, apiKey));
  mountRoutes(app, db);
  const server = await new Promise<Server>((ready) => {
    const listening = app.listen(0, () => ready(listening));
  });
  return {
    origin: `http://localhost:${(server.address() as AddressInfo).port}`,
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
