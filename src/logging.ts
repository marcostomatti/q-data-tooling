/**
 * The logging vocabulary of this repository: the `Log` every module writes to, the four fields a
 * line's breadcrumb is made of, and the helpers that bind the domain and the scope on a child.
 *
 * A line carries `domain` (PascalCase, `Widgets`), `scope` (the camelCase verb at the entry
 * point of a file's workflow, `create`) and `step` (the camelCase verb of one call, `insert`),
 * and a line written while serving one HTTP request or one MCP tool call carries that call's
 * `traceId`. Only those four fields are ever bound on a child; the data of a call goes in that
 * call's context object, never in bindings.
 *
 * `lazyLogger` writes to stdout; `stderrLogger` writes the same shape to stderr, for code that may
 * run as the stdio MCP server, whose stdout carries the protocol.
 *
 * @module
 */

import { createLogger } from '@open-tomato/service-logger';

/**
 * The five levels this repository logs at, each taking a context object and a message, and
 * `child`, which returns a `Log` whose every line also carries `bindings`. A field bound again on
 * a child replaces the parent's value for that field only.
 */
export type Log = {
  trace(context: object, message: string): void
  debug(context: object, message: string): void
  info(context: object, message: string): void
  warn(context: object, message: string): void
  error(context: object, message: string): void
  child(bindings: object): Log
};

/** The field naming the HTTP request or MCP tool call a line was written while serving. */
export const TRACE_ID_FIELD = 'traceId';

/** The field naming the domain a line belongs to, in PascalCase (`Widgets`). */
export const DOMAIN_FIELD = 'domain';

/** The field naming the workflow entry point a line was written under, a camelCase verb. */
export const SCOPE_FIELD = 'scope';

/** The field naming the step of one call, a camelCase verb given in that call's context. */
export const STEP_FIELD = 'step';

/** The breadcrumb fields a line may carry, each optional. */
export type LogBreadcrumb = {
  readonly [TRACE_ID_FIELD]?: string
  readonly [DOMAIN_FIELD]?: string
  readonly [SCOPE_FIELD]?: string
  readonly [STEP_FIELD]?: string
};

/** A child of `log` whose every line carries `domain`. */
export function inDomain(log: Log, domain: string): Log {
  return log.child({ [DOMAIN_FIELD]: domain });
}

/** A child of `log` whose every line carries `scope`, replacing a scope bound above it. */
export function scoped(log: Log, scope: string): Log {
  return log.child({ [SCOPE_FIELD]: scope });
}

/** pino's numbers for the level names `LOG_LEVEL` takes, so a stderr line reads like a pino one. */
const LEVEL_VALUES = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
} as const;

/** The level a name outside `LEVEL_VALUES` falls back to, pino's own default. */
const DEFAULT_LEVEL = 'info';

/** The number of a level name, or of `DEFAULT_LEVEL` when the name is not one. */
function levelValue(name: string): number {
  return name in LEVEL_VALUES
    ? LEVEL_VALUES[name as keyof typeof LEVEL_VALUES]
    : LEVEL_VALUES[DEFAULT_LEVEL];
}

/** What a stderr logger is built from; a test passes its own `write` and `level`. */
export type StderrLoggerOptions = {
  readonly write?: (line: string) => void
  readonly level?: string
};

/** An `Error` as pino's `err` serializer writes it, since `JSON.stringify` drops its fields. */
function serializeValue(_key: string, value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return { type: value.name, message: value.message, stack: value.stack };
}

/**
 * A `Log` that writes one pino-shaped JSON line per call to stderr, honouring `LOG_LEVEL` as
 * pino does. It is the logger for code that may run as the stdio MCP server, where stdout
 * carries the protocol and a `lazyLogger` line there would corrupt the stream. A line whose
 * context cannot be serialized is written with its message and level only.
 */
export function stderrLogger(name: string, options: StderrLoggerOptions = {}): Log {
  const write = options.write ?? ((line: string) => void process.stderr.write(line));
  const threshold = levelValue(options.level ?? process.env['LOG_LEVEL'] ?? DEFAULT_LEVEL);
  const build = (bindings: object): Log => {
    const at = (level: number) => (context: object, message: string): void => {
      if (level < threshold) return;
      const head = { level, time: Date.now(), service: name };
      let line: string;
      try {
        line = JSON.stringify({ ...head, ...bindings, ...context, msg: message }, serializeValue);
      } catch {
        line = JSON.stringify({ ...head, msg: message });
      }
      write(`${line}\n`);
    };
    return {
      trace: at(LEVEL_VALUES.trace),
      debug: at(LEVEL_VALUES.debug),
      info: at(LEVEL_VALUES.info),
      warn: at(LEVEL_VALUES.warn),
      error: at(LEVEL_VALUES.error),
      child: (more) => build({ ...bindings, ...more }),
    };
  };
  return build({});
}

/**
 * A function that returns the named logger, built on its first call and reused after. The
 * logger is not made when this is called, nor when the importing module is loaded, so a module
 * whose logging sits in a branch that may never run (an authenticating service that has its
 * key) never builds a logger it does not use. The `service-logger` `Logger` satisfies `Log`.
 */
export function lazyLogger(name: string): () => Log {
  let cached: Log | undefined;
  return () => {
    cached ??= createLogger(name);
    return cached;
  };
}
