import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { migrateCommand, migrationsFolderFor } from '../../src/data/migrate.ts';
import { captureLog } from '../support/capture-log.ts';

// The migrators themselves run against a database, in tests/integration/data/migrate.test.ts.

describe('migrationsFolderFor', () => {
  test('names drizzle/<dialect>/ at the repository root, as drizzle.config.ts does', () => {
    const root = join(import.meta.dir, '..', '..');
    expect(migrationsFolderFor('sqlite')).toBe(join(root, 'drizzle', 'sqlite'));
    expect(migrationsFolderFor('pg')).toBe(join(root, 'drizzle', 'pg'));
  });
});

describe('migrateCommand', () => {
  test('signs its count line Db:migrate, with the apply step, and closes the database', async () => {
    const { log, records } = captureLog();
    let closed = 0;

    const exitCode = await migrateCommand({ migrate: async () => 2, close: async () => void closed++, log });

    expect(exitCode).toBe(0);
    expect(closed).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'info', domain: 'Db', scope: 'migrate', step: 'apply', applied: 2, msg: 'applied migrations' }),
    ]);
  });

  test('logs a failure by its driver code under Db:migrate, never by its message, and exits 1', async () => {
    const { log, records } = captureLog();
    const fault = Object.assign(new Error('secret postgres://user:pw@host/db'), { code: '28P01' });

    const exitCode = await migrateCommand({ migrate: async () => { throw fault; }, close: async () => {}, log });

    expect(exitCode).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'error', domain: 'Db', scope: 'migrate', step: 'apply', code: '28P01', msg: 'migration failed' }),
    ]);
    expect(JSON.stringify(records)).not.toContain('secret');
  });
});
