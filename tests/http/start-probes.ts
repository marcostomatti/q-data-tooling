/**
 * What the `startService` tests share: made-up settings it needs to start, a probe for whether
 * it listens, a watch on the ports it binds, and a way to put a variable back. Used by
 * `tests/http/server.test.ts`, whose starts are refused before any database is opened, and
 * `tests/integration/http/server.test.ts`, whose starts run on a scratch Postgres database.
 *
 * @module
 */

import http from 'node:http';

import { spyOn } from 'bun:test';

import { GENERATED_KEY_LENGTH } from '../../src/auth/api-key.ts';

/**
 * A key made up for these tests; it matches nothing real. It is as long as a generated one, so
 * starting the service with it does not draw the short-key warning and add noise to every run.
 */
export const TEST_KEY = 'test-key-for-the-server-entry-'.padEnd(GENERATED_KEY_LENGTH, 'k');

/** A made-up SEC User-Agent at a reserved domain; no test reaches SEC with it. */
export const TEST_SEC_USER_AGENT = 'q-data-tooling server tests tests@example.com';

/**
 * Whether a service answers `GET /health` at `url`.
 *
 * @param url - The service's origin.
 * @returns `false` when nothing listens there.
 */
export async function answers(url: string): Promise<boolean> {
  return fetch(`${url}/health`).then((response) => response.ok, () => false);
}

/**
 * Runs `act` with `http.Server.prototype.listen` watched. The chassis listens with
 * `createServer(app).listen(port)`. The calls are read before the spy is restored, because a
 * restore clears them.
 *
 * @param act - What to run while the spy watches.
 * @returns The port each `listen` call asked for, in order.
 */
export async function listenedPorts(act: () => Promise<unknown>): Promise<readonly unknown[]> {
  const listen = spyOn(http.Server.prototype, 'listen');
  try {
    await act();
    return listen.mock.calls.map((call) => call[0]);
  } finally {
    listen.mockRestore();
  }
}

/**
 * Sets `process.env[name]` back to `value`.
 *
 * @param name - The variable.
 * @param value - What it held; `undefined` unsets it.
 */
export function restoreVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
