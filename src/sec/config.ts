/**
 * The User-Agent every request to SEC carries. SEC answers 403 to a request that does not declare
 * who sends it, in the form `<app name> <contact email>`, so a service without one could sync no
 * filings at all. It is read once, before the service opens anything, and a missing or unusable
 * value stops the start instead of surfacing later as a 502 on the first filings request.
 *
 * @module
 */

/** The variable the User-Agent is read from. */
export const SEC_USER_AGENT_VARIABLE = 'SEC_USER_AGENT';

/**
 * A contact email somewhere in the value. SEC asks for one, and a value without it is answered
 * like no value at all. The shape is loose on purpose: an address SEC can write to is the
 * operator's call, and this only catches a value that holds no address.
 */
const CONTACT_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** A line break or other control character, which would split the header or make `fetch` throw. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * Thrown before anything is opened when `SEC_USER_AGENT` is missing, blank, holds no contact
 * email or holds a control character. The message names the variable and the fix, and never
 * repeats the value, since it holds an email address and start errors are printed.
 */
export class InvalidSecUserAgentError extends Error {
  /**
   * @param problem - What is wrong with the value, as a clause such as `is not set`.
   */
  constructor(problem: string) {
    super(
      `${SEC_USER_AGENT_VARIABLE} ${problem}, and SEC answers 403 to a request without a declared ` +
        'User-Agent, so the service will not start. Set it in .env as ' +
        `${SEC_USER_AGENT_VARIABLE}="<app name> <contact email>" (see docs/setup.md).`,
    );
    this.name = 'InvalidSecUserAgentError';
  }
}

/**
 * Reads and checks the SEC User-Agent from `env`. Spaces around the value are dropped.
 *
 * @param env - The environment to read, `process.env` at startup.
 * @returns The User-Agent to send, trimmed.
 * @throws {InvalidSecUserAgentError} when the value is unset or blank, holds a control character,
 * or holds no contact email.
 */
export function readSecUserAgent(env: Record<string, string | undefined>): string {
  const value = env[SEC_USER_AGENT_VARIABLE]?.trim() ?? '';
  if (value === '') throw new InvalidSecUserAgentError('is not set');
  if (CONTROL_CHARACTER.test(value)) throw new InvalidSecUserAgentError('holds a line break or another control character');
  if (!CONTACT_EMAIL.test(value)) throw new InvalidSecUserAgentError('holds no contact email');
  return value;
}
