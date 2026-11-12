import { describe, expect, test } from 'bun:test';

import { sign, tokenName, unsign } from '../../src/auth/store.ts';

// The store's database functions are tested on Postgres, in tests/integration/auth/store.test.ts.

describe('sign and unsign', () => {
  test('a signed value comes back; a changed value or signature does not', () => {
    const signed = sign('abc', 'secret-one');

    expect(unsign(signed, 'secret-one')).toBe('abc');
    expect(unsign(signed, 'secret-two')).toBeUndefined();
    expect(unsign(`x${signed}`, 'secret-one')).toBeUndefined();
    expect(unsign(`${signed}x`, 'secret-one')).toBeUndefined();
    expect(unsign('no-signature', 'secret-one')).toBeUndefined();
  });
});

describe('tokenName', () => {
  test.each([['', 'empty'], ['   ', 'blank'], ['x'.repeat(81), 'too long'], [42, 'not text']])(
    'a token name %p (%s) is refused',
    (raw) => {
      expect(() => tokenName(raw)).toThrow(/name/);
    },
  );

  test('a token name is trimmed', () => {
    expect(tokenName('  laptop  ')).toBe('laptop');
  });
});
