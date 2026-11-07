/**
 * One id per request across the chassis and the routes: the chassis picks a request's trace id,
 * answers it in `x-request-id` and logs it on its `request completed` line, and a route answers
 * and logs the same id, so a caller who quotes the header finds every line of the request.
 *
 * @module
 */

import type { ServiceProcess } from '../support/service-process.ts';

import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { GENERATED_KEY_LENGTH } from '../../src/auth/api-key.ts';
import { startServiceProcess } from '../support/service-process.ts';

/** Made up for this file; it matches nothing real. As long as a generated key, so no short-key warning. */
const TEST_KEY = 'trace-id-test-key-'.padEnd(GENERATED_KEY_LENGTH, 'k');

/** The message the chassis's request logger writes once a request is answered. */
const REQUEST_COMPLETED = 'request completed';

/** The message of the debug line the `/api/info` route writes itself, on its request's log. */
const INFO_READ = 'service info read';

/** How long to wait for the chassis's line, written on the response's `finish`, after the fetch. */
const LINE_WAIT_MS = 2000;
const POLL_MS = 10;

let service: ServiceProcess | undefined;

afterEach(async () => {
  await service?.stop();
  service = undefined;
});

type LogLine = Readonly<Record<string, unknown>>;

/** The JSON lines of `written`, parsed; any other output is skipped. */
function jsonLines(written: readonly string[]): readonly LogLine[] {
  return written.join('').split('\n')
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === 'object' && parsed !== null
          ? [parsed as LogLine]
          : [];
      } catch {
        return [];
      }
    });
}

/**
 * Every JSON line written to stdout while `act` runs and until a line with message `until` has
 * been written, or `LINE_WAIT_MS` has passed, so a line written after the response still counts.
 */
async function stdoutLines(act: () => Promise<void>, until: string): Promise<readonly LogLine[]> {
  const written: string[] = [];
  const write = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string'
      ? chunk
      : new TextDecoder().decode(chunk));
    return true;
  });
  try {
    await act();
    const deadline = Date.now() + LINE_WAIT_MS;
    while (!jsonLines(written).some((line) => line.msg === until) && Date.now() < deadline) await Bun.sleep(POLL_MS);
  } finally {
    write.mockRestore();
  }
  return jsonLines(written);
}

describe('the trace id of a request', () => {
  test('a request sent with no x-request-id is answered, and logged by the chassis and the route, under one id', async () => {
    service = await startServiceProcess({ API_KEY: TEST_KEY, LOG_LEVEL: 'debug', LOG_FORMAT: 'json' });
    const origin = service.origin;
    let answered: string | null = null;

    const lines = await stdoutLines(async () => {
      const response = await fetch(`${origin}/api/info`, { headers: { authorization: `Bearer ${TEST_KEY}` } });
      answered = response.headers.get('x-request-id');
      await response.body?.cancel();
    }, REQUEST_COMPLETED);

    const completed = lines.filter((line) => line.msg === REQUEST_COMPLETED);
    const routeLines = lines.filter((line) => line.msg === INFO_READ);
    expect(answered).not.toBeNull();
    expect(completed).toHaveLength(1);
    expect(completed[0]?.traceId).toBe(answered);
    expect(routeLines).toHaveLength(1);
    expect(routeLines[0]?.traceId).toBe(answered);
  });
});
