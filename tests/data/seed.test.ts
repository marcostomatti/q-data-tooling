import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { listSeeds, seedCommand, SeedFailedError, SeedNameError, SEEDS_FOLDER } from '../../src/data/seed.ts';
import { captureLog } from '../support/capture-log.ts';

// `runSeeds` and `bun run db:seed` write to a database, in tests/integration/data/seed.test.ts.

const FIXTURES = join(import.meta.dir, 'fixtures', 'seeds');

describe('listSeeds', () => {
  test('lists the .ts seed files in name order and leaves the rest out', () => {
    expect(listSeeds(join(FIXTURES, 'ordered'))).toEqual(['01-first.ts', '02-second.ts']);
  });

  test('a missing folder is zero seeds', () => {
    const absent = join(FIXTURES, 'absent');
    expect(existsSync(absent)).toBe(false);
    expect(listSeeds(absent)).toEqual([]);
  });

  test('refuses a .ts file off the <NN>-<name>.ts pattern, naming it', () => {
    expect(() => listSeeds(join(FIXTURES, 'misnamed'))).toThrow(SeedNameError);
    expect(() => listSeeds(join(FIXTURES, 'misnamed'))).toThrow('seed file 1-short.ts is not named <NN>-<name>.ts');
  });

  test('reads src/data/seeds/ by default', () => {
    expect(SEEDS_FOLDER).toBe(join(import.meta.dir, '..', '..', 'src', 'data', 'seeds'));
  });
});

describe('seedCommand', () => {
  test('signs its line Db:seed, with the run step, and closes the database', async () => {
    const { log, records } = captureLog();
    let closed = 0;

    const exitCode = await seedCommand({ seed: async () => ['01-a.ts'], close: async () => void closed++, log });

    expect(exitCode).toBe(0);
    expect(closed).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'info', domain: 'Db', scope: 'seed', step: 'run', ran: 1, seeds: ['01-a.ts'], msg: 'ran seeds' }),
    ]);
  });

  test('logs a failed seed by its file and driver code under Db:seed, never by its message', async () => {
    const { log, records } = captureLog();
    const fault = Object.assign(new Error('secret statement'), { code: '23505' });

    const exitCode = await seedCommand({ seed: async () => { throw new SeedFailedError('02-b.ts', fault); }, close: async () => {}, log });

    expect(exitCode).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'error', domain: 'Db', scope: 'seed', step: 'run', seed: '02-b.ts', code: '23505', msg: 'seed failed' }),
    ]);
    expect(JSON.stringify(records)).not.toContain('secret');
  });

  test('logs a misnamed seed file as the list step', async () => {
    const { log, records } = captureLog();

    const exitCode = await seedCommand({ seed: async () => { throw new SeedNameError('seed.ts'); }, close: async () => {}, log });

    expect(exitCode).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'error', domain: 'Db', scope: 'seed', step: 'list', seed: 'seed.ts', msg: 'seed file misnamed' }),
    ]);
  });
});
