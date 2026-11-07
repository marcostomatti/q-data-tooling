import { describe, test } from 'bun:test';

/** The variable that opens the gate: a Postgres URL the gated tests may connect to and write in. */
export const PG_GATE_VARIABLE = 'TEST_PG_URL';

/** Appended to a gated block's name when the gate is closed, so the skip says why it happened. */
export const PG_GATE_REASON = `(skipped: ${PG_GATE_VARIABLE} is not set)`;

/** Whether `env` names a Postgres database for the gated tests; an empty value counts as unset. */
export function isPgGateOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = env[PG_GATE_VARIABLE];
  return url !== undefined && url !== '';
}

/**
 * The URL the gated tests connect to. Call it inside a gated block's hooks or tests, never at
 * a file's top level, where it would throw with the gate closed.
 *
 * @throws {Error} when `TEST_PG_URL` is unset or empty.
 */
export function testPgUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env[PG_GATE_VARIABLE];
  if (url === undefined || url === '') throw new Error(`${PG_GATE_VARIABLE} is not set; run this inside describePg`);
  return url;
}

/**
 * `describe` when `TEST_PG_URL` is set, and `describe.skip` with {@link PG_GATE_REASON} in its
 * name when it is not, for tests that need a Postgres server.
 *
 * With the gate closed, `body` is never called. `describe.skip` alone would not do: Bun 1.3
 * runs a skipped block's callback to collect its tests, so code in the body (a pool opened
 * outside a hook, say) would still run. The skipped block holds one stand-in test instead, so
 * the skip shows in the run's count.
 *
 * @param name - The block's name; the reason is appended to it when the gate is closed.
 * @param body - The block's hooks and tests, called only when the gate is open.
 * @param env - Where `TEST_PG_URL` is read. Defaults to `process.env`.
 */
export function describePg(name: string, body: () => void, env: NodeJS.ProcessEnv = process.env): void {
  if (isPgGateOpen(env)) {
    describe(name, body);
    return;
  }
  describe.skip(`${name} ${PG_GATE_REASON}`, () => {
    test(`needs ${PG_GATE_VARIABLE}`, () => {});
  });
}
