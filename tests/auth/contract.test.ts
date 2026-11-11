import { describe, expect, test } from 'bun:test';

import {
  createdToken,
  createTokenInput,
  loginInput,
  sessionState,
  signInState,
  TOKEN_ID_MAX,
  TOKEN_NAME_MAX,
  tokenIdParam,
  tokenSummary,
} from '../../src/auth/contract.ts';

const SUMMARY = {
  id: 1,
  name: 'ci',
  prefix: 'app_abcd',
  createdAt: '2026-11-06T10:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

/** Each schema with a valid value, an unknown field added to it, and a field of the wrong type. */
const CASES = [
  { name: 'loginInput', schema: loginInput, valid: { password: 'hunter2' }, wrongType: { password: 42 } },
  { name: 'createTokenInput', schema: createTokenInput, valid: { name: 'ci' }, wrongType: { name: 7 } },
  { name: 'tokenIdParam', schema: tokenIdParam, valid: { id: '12' }, wrongType: { id: 'twelve' } },
  { name: 'sessionState', schema: sessionState, valid: { mode: 'password', signedIn: true }, wrongType: { mode: 'password', signedIn: 'yes' } },
  { name: 'signInState', schema: signInState, valid: { signedIn: false }, wrongType: { signedIn: 0 } },
  { name: 'tokenSummary', schema: tokenSummary, valid: SUMMARY, wrongType: { ...SUMMARY, id: '1' } },
  { name: 'createdToken', schema: createdToken, valid: { token: 'app_abcdefgh', summary: SUMMARY }, wrongType: { token: 'app_abcdefgh', summary: 'none' } },
] as const;

describe('every auth schema', () => {
  for (const { name, schema, valid, wrongType } of CASES) {
    test(`${name} refuses an unknown field and a wrong type, and accepts a valid value`, () => {
      const unknown = schema.safeParse({ ...valid, extra: true });
      expect(unknown.success).toBe(false);
      expect(unknown.error?.issues[0]?.code).toBe('unrecognized_keys');

      const wrong = schema.safeParse(wrongType);
      expect(wrong.success).toBe(false);

      expect(schema.safeParse(valid).success).toBe(true);
    });
  }
});

describe('loginInput', () => {
  test('refuses an empty password and one past 1024 characters', () => {
    expect(loginInput.safeParse({ password: '' }).success).toBe(false);
    expect(loginInput.safeParse({ password: 'x'.repeat(1025) }).success).toBe(false);
    expect(loginInput.safeParse({ password: 'x'.repeat(1024) }).success).toBe(true);
  });
});

describe('createTokenInput', () => {
  const rule = `a token needs a name of 1 to ${TOKEN_NAME_MAX} characters`;

  test('trims the name', () => {
    expect(createTokenInput.parse({ name: '  ci  ' })).toEqual({ name: 'ci' });
  });

  test('takes a name of exactly the most characters once trimmed', () => {
    expect(createTokenInput.parse({ name: ` ${'n'.repeat(TOKEN_NAME_MAX)} ` }).name).toHaveLength(TOKEN_NAME_MAX);
  });

  test('refuses a blank, a too-long, a missing and a non-string name with the store message', () => {
    for (const body of [{ name: '   ' }, { name: 'n'.repeat(TOKEN_NAME_MAX + 1) }, {}, { name: 7 }]) {
      const result = createTokenInput.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(rule);
    }
  });
});

describe('tokenIdParam', () => {
  test('reads the id from its path segment as a number', () => {
    expect(tokenIdParam.parse({ id: '12' })).toEqual({ id: 12 });
    expect(tokenIdParam.parse({ id: String(TOKEN_ID_MAX) })).toEqual({ id: TOKEN_ID_MAX });
  });

  test('refuses zero, a negative, a fraction and an id past the bound', () => {
    for (const id of ['0', '-1', '1.5', String(TOKEN_ID_MAX + 1)]) {
      expect(tokenIdParam.safeParse({ id }).success).toBe(false);
    }
  });
});

describe('sessionState', () => {
  test('takes each login mode and refuses any other', () => {
    for (const mode of ['none', 'password', 'oidc']) {
      expect(sessionState.safeParse({ mode, signedIn: false }).success).toBe(true);
    }
    expect(sessionState.safeParse({ mode: 'saml', signedIn: false }).success).toBe(false);
  });
});

describe('tokenSummary', () => {
  test('takes ISO times for the last use and the revocation', () => {
    const used = { ...SUMMARY, lastUsedAt: '2026-11-06T11:00:00.000Z', revokedAt: '2026-11-06T12:00:00.000Z' };
    expect(tokenSummary.parse(used)).toEqual(used);
  });

  test('refuses a time that is not ISO 8601', () => {
    expect(tokenSummary.safeParse({ ...SUMMARY, createdAt: 'yesterday' }).success).toBe(false);
  });

  test('refuses a summary that carries the token', () => {
    expect(tokenSummary.safeParse({ ...SUMMARY, token: 'app_abcdefgh' }).success).toBe(false);
  });
});

describe('createdToken', () => {
  test('refuses a summary with an unknown field inside it', () => {
    expect(createdToken.safeParse({ token: 'app_abcdefgh', summary: { ...SUMMARY, extra: 1 } }).success).toBe(false);
  });
});
