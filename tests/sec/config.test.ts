import { describe, expect, test } from 'bun:test';

import { InvalidSecUserAgentError, readSecUserAgent, SEC_USER_AGENT_VARIABLE } from '../../src/sec/config.ts';

/** A made-up value at a reserved domain, in the form SEC asks for. */
const VALID = 'q-data-tooling tests tests@example.com';

/** What `readSecUserAgent` threw on `value`, or `undefined` when it returned. */
function refusal(value: string | undefined): unknown {
  try {
    readSecUserAgent({ [SEC_USER_AGENT_VARIABLE]: value });
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

describe('readSecUserAgent', () => {
  test('reads SEC_USER_AGENT and returns it trimmed', () => {
    expect(SEC_USER_AGENT_VARIABLE).toBe('SEC_USER_AGENT');
    expect(readSecUserAgent({ SEC_USER_AGENT: VALID })).toBe(VALID);
    expect(readSecUserAgent({ SEC_USER_AGENT: `  ${VALID}\t` })).toBe(VALID);
  });

  test.each([
    ['unset', undefined, 'is not set'],
    ['empty', '', 'is not set'],
    ['blank', ' \t ', 'is not set'],
    ['without a contact email', 'q-data-tooling tests', 'holds no contact email'],
    ['with an @ but no domain', 'q-data-tooling tests@', 'holds no contact email'],
    ['with a line break', 'q-data-tooling\r\nX-Injected: tests@example.com', 'holds a line break or another control character'],
  ])('refuses a value %s, naming the problem', (_label, value, problem) => {
    const failure = refusal(value);

    expect(failure).toBeInstanceOf(InvalidSecUserAgentError);
    expect((failure as Error).name).toBe('InvalidSecUserAgentError');
    expect((failure as Error).message).toContain(`SEC_USER_AGENT ${problem}`);
  });

  test('the refusal names the fix and never repeats the value it refused', () => {
    const value = 'private-app-name-for-this-test';

    const failure = refusal(value);

    expect(failure).toBeInstanceOf(InvalidSecUserAgentError);
    expect((failure as Error).message).toContain('SEC_USER_AGENT="<app name> <contact email>"');
    expect((failure as Error).message).toContain('docs/setup.md');
    expect((failure as Error).message).not.toContain(value);
  });

  test('reads no other variable: a User-Agent under another name is not taken', () => {
    expect(refusal(undefined)).toBeInstanceOf(InvalidSecUserAgentError);
    expect(() => readSecUserAgent({ USER_AGENT: VALID, SEC_USER_AGENT_X: VALID })).toThrow(InvalidSecUserAgentError);
  });
});
