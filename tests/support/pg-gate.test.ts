import { describe, expect, test } from 'bun:test';

import { describePg, isPgGateOpen, PG_GATE_REASON, testPgUrl } from './pg-gate.ts';

const OPEN = { TEST_PG_URL: 'postgres://u:p@localhost:5432/d' };
const CLOSED = {};

// A block's body runs while Bun collects the file, before any test, so these record at load.
let closedBodyRan = false;
let openBodyRan = false;
describePg('a block behind the closed gate', () => {
  closedBodyRan = true;
}, CLOSED);
describePg('a block behind the open gate', () => {
  openBodyRan = true;
  test('runs', () => {});
}, OPEN);

describe('describePg', () => {
  test('never calls the body with the gate closed', () => {
    expect(closedBodyRan).toBe(false);
  });

  test('calls the body with the gate open, so the closed reading could have failed', () => {
    expect(openBodyRan).toBe(true);
  });

  test('names the variable in the reason a skipped block carries', () => {
    expect(PG_GATE_REASON).toBe('(skipped: TEST_PG_URL is not set)');
  });
});

describe('isPgGateOpen', () => {
  test('is open only for a non-empty TEST_PG_URL', () => {
    expect(isPgGateOpen(OPEN)).toBe(true);
    expect(isPgGateOpen(CLOSED)).toBe(false);
    expect(isPgGateOpen({ TEST_PG_URL: '' })).toBe(false);
  });
});

describe('testPgUrl', () => {
  test('returns TEST_PG_URL when it is set', () => {
    expect(testPgUrl(OPEN)).toBe(OPEN.TEST_PG_URL);
  });

  test('throws a message naming the variable when it is not', () => {
    expect(() => testPgUrl(CLOSED)).toThrow(/TEST_PG_URL is not set/);
    expect(() => testPgUrl({ TEST_PG_URL: '' })).toThrow(/TEST_PG_URL is not set/);
  });
});
