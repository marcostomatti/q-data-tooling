import { describe, expect, test } from 'bun:test';

import { faultCode, UNKNOWN_FAULT_CODE } from '../../src/data/driver-faults.ts';

// The code of a real driver fault, from a running server, is read in
// tests/integration/data/driver-faults.test.ts.

describe('faultCode', () => {
  test('reads the code of the error itself', () => {
    expect(faultCode(Object.assign(new Error('boom'), { code: '28P01' }))).toBe('28P01');
  });

  test('reads the code of the driver error Drizzle wraps as the cause', () => {
    const wrapped = new Error('Failed query', { cause: Object.assign(new Error('x'), { code: '40001' }) });
    expect(faultCode(wrapped)).toBe('40001');
  });

  test('falls back to unknown when no string code is there', () => {
    expect(UNKNOWN_FAULT_CODE).toBe('unknown');
    expect(faultCode(new RangeError('Cannot use a closed database'))).toBe('unknown');
    expect(faultCode(Object.assign(new Error('x'), { code: 14 }))).toBe('unknown');
    expect(faultCode(null)).toBe('unknown');
    expect(faultCode('a string')).toBe('unknown');
  });
});
