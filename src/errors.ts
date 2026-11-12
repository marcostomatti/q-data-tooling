import { ZodError } from 'zod';

import { SecRequestError } from './sec/client.ts';

const HTTP_STATUS = {
  badRequest: 400,
  notFound: 404,
  conflict: 409,
  internal: 500,
  badGateway: 502,
  unavailable: 503,
} as const;

/** What a caller is told about any error that is not one of the known classes: nothing. */
const INTERNAL_ERROR = { name: 'InternalError', message: 'internal error' } as const;

/**
 * A thing the caller named does not exist. `cause` carries the driver fault when the database's
 * own foreign key is what found it out, and is never part of the message.
 */
export class NotFoundError extends Error {
  readonly entity: string;
  readonly id: string | number;

  constructor(entity: string, id: string | number, options?: ErrorOptions) {
    super(`${entity} ${id} does not exist`, options);
    this.name = 'NotFoundError';
    this.entity = entity;
    this.id = id;
  }
}

/**
 * The caller's request conflicts with what is stored: most often a thing it tried to create
 * already exists under this key, which is what the default message says. A conflict of another
 * kind passes its own `message`, because "already exists" would be false for it. `field` and
 * `key` still say what collided. `cause` keeps the driver fault and is never part of the message.
 *
 * A custom `message` is shown to callers verbatim: the MCP and HTTP surfaces send a conflict's
 * message as it is, and a bulk failure repeats it. It must therefore be a literal built from
 * what the caller supplied, and never derived from a driver fault, whose message is the failed
 * SQL statement. The fault belongs on `cause`.
 */
export class ConflictError extends Error {
  readonly field: string;
  readonly key: string;

  constructor(field: string, key: string, options?: ErrorOptions & { message?: string }) {
    super(options?.message ?? `${field} ${key} already exists`, options);
    this.name = 'ConflictError';
    this.field = field;
    this.key = key;
  }
}

/** One item in a bulk write failed; `index` says which one. The cause is kept off the message. */
export class BulkItemError extends Error {
  readonly index: number;

  constructor(index: number, cause: unknown) {
    super(`bulk item ${index} failed`, { cause });
    this.name = 'BulkItemError';
    this.index = index;
  }
}

/**
 * The Open Notebook companion could not be used: it did not answer, the connection failed, or
 * it answered in a shape this service does not know. `reason` is one of a few fixed phrases
 * written here, never the notebook's URL or a driver message, so it is safe to show a caller.
 */
export class NotebookUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string, options?: ErrorOptions) {
    super(`the notebook is unavailable: ${reason}`, options);
    this.name = 'NotebookUnavailableError';
    this.reason = reason;
  }
}

/**
 * The Open Notebook companion answered and refused the request. `status` is its HTTP status.
 * The message is a fixed phrase per kind of status and never carries the notebook's own
 * `detail`, because Open Notebook often builds that text from an internal exception.
 */
export class NotebookRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'NotebookRequestError';
    this.status = status;
  }
}

/** Maps an error to the HTTP status both surfaces send. Anything unrecognised is a 500. */
export function statusFor(error: unknown): number {
  if (error instanceof NotFoundError) return HTTP_STATUS.notFound;
  if (error instanceof ConflictError) return HTTP_STATUS.conflict;
  if (error instanceof BulkItemError || error instanceof ZodError) return HTTP_STATUS.badRequest;
  if (error instanceof NotebookUnavailableError) return HTTP_STATUS.unavailable;
  if (error instanceof NotebookRequestError) return HTTP_STATUS.badGateway;
  if (error instanceof SecRequestError) return HTTP_STATUS.badGateway;
  return HTTP_STATUS.internal;
}

/**
 * The classes whose name and message are safe to show a caller. A subclass of one, such as a
 * `ConflictError` subclass, is caught by that entry. The two notebook errors are here because
 * their messages are built from fixed phrases and a status, never from a URL, a key or the
 * notebook's own error text. `SecRequestError` and its subclasses are here because their
 * messages are fixed phrases with the SEC status and the public SEC URL, never the User-Agent
 * and never SEC's own body. `ZodError` is not here: the SDK
 * parses a tool's input before `run` is reached, so a `ZodError` that arrives here came from
 * inside the server, and its issues could carry stored data.
 */
function isKnownError(error: unknown): error is Error {
  return (
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof BulkItemError ||
    error instanceof NotebookUnavailableError ||
    error instanceof NotebookRequestError ||
    error instanceof SecRequestError
  );
}

/** The two fields a caller is shown for an error, and nothing else. */
export interface ErrorDescription {
  readonly name: string
  readonly message: string
}

/**
 * What a caller is told about an error, built field by field from `name` and `message` and
 * nothing else. This is the one place the wording is decided, so a surface that wraps it in its
 * own envelope (the MCP content block in `src/mcp/result.ts`, `{ success: false, error }` over
 * HTTP) shows the same text for the same failure. It never serialises the error and never reads
 * `cause` except as described next, because `cause` holds the driver fault, and a driver fault's
 * message is the failed SQL statement.
 *
 * A `BulkItemError` says which item failed, and adds why when its cause is itself a known class,
 * because those messages are built from fields the caller supplied. An unknown cause adds
 * nothing, so the leak property holds.
 *
 * A known class's message is emitted verbatim, so it must never be derived from a driver fault,
 * and that includes the free-text `message` option of `ConflictError`: pass a literal built from
 * what the caller supplied, never `error.message` of a caught driver error.
 *
 * An error outside the known classes could be anything, a connection string included, so it
 * becomes the same flat constant, `InternalError` with `internal error`, which carries nothing
 * of the thrown value: no name, no message, no cause. A `ZodError`
 * is flat here only because this is called from the MCP handler, where the SDK has already
 * parsed the input. A surface that parses with the schema itself must treat a `ZodError` as
 * caller input before it reaches this function.
 */
export function describeError(error: unknown): ErrorDescription {
  if (!isKnownError(error)) return INTERNAL_ERROR;
  const { name, message } = error;
  if (error instanceof BulkItemError && isKnownError(error.cause)) {
    return { name, message: `${message}: ${error.cause.message}` };
  }
  return { name, message };
}
