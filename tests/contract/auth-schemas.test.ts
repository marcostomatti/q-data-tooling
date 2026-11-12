import { describe, expect, test } from 'bun:test';

import { createdToken, sessionState, signInState, tokenSummary } from '../../src/auth/contract.ts';

// The /auth routes against the running service are tested on Postgres, in
// tests/integration/contract/auth-schemas.test.ts.

describe('the output schemas are strict', () => {
  test('an answer carrying one extra field is refused by each output schema', () => {
    const summary = {
      id: 1,
      name: 'n',
      prefix: 'p',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    };
    expect(sessionState.safeParse({ mode: 'none', signedIn: false }).success).toBe(true);
    expect(sessionState.safeParse({ mode: 'none', signedIn: false, extra: 1 }).success).toBe(false);
    expect(signInState.safeParse({ signedIn: true, extra: 1 }).success).toBe(false);
    expect(tokenSummary.safeParse(summary).success).toBe(true);
    expect(tokenSummary.safeParse({ ...summary, extra: 1 }).success).toBe(false);
    expect(createdToken.safeParse({ token: 't', summary, extra: 1 }).success).toBe(false);
  });
});
