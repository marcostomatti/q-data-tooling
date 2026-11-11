import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { faultCode, UNKNOWN_FAULT_CODE } from '../../src/data/driver-faults.ts';

describe('faultCode', () => {
  test('reads the code of the error itself', () => {
    expect(faultCode(Object.assign(new Error('boom'), { code: '28P01' }))).toBe('28P01');
  });

  test('reads the code of the driver error Drizzle wraps as the cause', () => {
    const wrapped = new Error('Failed query', { cause: Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }) });
    expect(faultCode(wrapped)).toBe('SQLITE_BUSY');
  });

  test('reads the code bun:sqlite gives a database it cannot open', () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), 'driver-faults-'));
    let error: unknown;

    // Act
    try {
      new Database(join(dir, 'missing', 'x.db'));
    } catch (caught: unknown) {
      error = caught;
    }
    rmSync(dir, { recursive: true, force: true });

    // Assert
    expect(faultCode(error)).toBe('SQLITE_CANTOPEN');
  });

  test('falls back to unknown when no string code is there', () => {
    expect(UNKNOWN_FAULT_CODE).toBe('unknown');
    expect(faultCode(new RangeError('Cannot use a closed database'))).toBe('unknown');
    expect(faultCode(Object.assign(new Error('x'), { code: 14 }))).toBe('unknown');
    expect(faultCode(null)).toBe('unknown');
    expect(faultCode('a string')).toBe('unknown');
  });
});
