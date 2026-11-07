/**
 * The capturing fake every logging test uses: a `Log` whose `child` merges its bindings over
 * the parent's, and whose every call appends one record to an array shared by the root and all
 * its children. A record is the bindings, then the call's context, then `level` and `msg`, so a
 * field the context names wins over the same field bound above it, as it does in a pino line.
 *
 * @module
 */

import type { Log } from '../../src/logging.ts';

/** The level a call was made at. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** One captured line: the bindings and context fields, with the call's `level` and `msg`. */
export type LogRecord = Readonly<Record<string, unknown>> & {
  readonly level: LogLevel
  readonly msg: string
};

/** A root `Log` and the records it and every child of it have written, in call order. */
export interface CapturedLog {
  readonly log: Log
  readonly records: readonly LogRecord[]
}

function capturing(bindings: object, records: LogRecord[]): Log {
  const write = (level: LogLevel) => (context: object, message: string): void => {
    records.push({ ...bindings, ...context, level, msg: message });
  };
  return {
    trace: write('trace'),
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (more: object) => capturing({ ...bindings, ...more }, records),
  };
}

/** A fresh capturing `Log` with no bindings and an empty record array. */
export function captureLog(): CapturedLog {
  const records: LogRecord[] = [];
  return { log: capturing({}, records), records };
}
