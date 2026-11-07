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
 * `lazyLogger` writes to stdout. The stdio MCP server's lines go through the package's logger,
 * which writes to stderr there, since its stdout carries the protocol. So code a tool runs logs on
 * the `log` it is handed, never on a `lazyLogger`, whose stdout line would land in the protocol.
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
