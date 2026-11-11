import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { listSeeds, runSeeds, seedCommand, SeedFailedError, SeedNameError, SEEDS_FOLDER } from '../../src/data/seed.ts';
import { captureLog } from '../support/capture-log.ts';
import { openMigratedMemoryDb, type SqliteTestClient } from '../support/sqlite-db.ts';

import { seed as throwingSeed } from './fixtures/seeds/failing/02-throws.ts';

const FIXTURES = join(import.meta.dir, 'fixtures', 'seeds');

let db: SqliteTestClient;

beforeEach(() => {
  db = openMigratedMemoryDb();
});

afterEach(() => {
  db.$client.close();
});

/** The `app_config` rows whose key starts with `prefix`, as key and stored JSON text, sorted. */
function rowsStored(prefix: string): { key: string; value: string }[] {
  return db.$client
    .query<{ key: string; value: string }, [string]>('select key, value from app_config where key like ? order by key')
    .all(`${prefix}%`);
}

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

describe('runSeeds', () => {
  test('runs every seed in order and returns their names', async () => {
    expect(await runSeeds(db, join(FIXTURES, 'ordered'))).toEqual(['01-first.ts', '02-second.ts']);

    // `seed-second` holds whether `seed-first` was there when it ran: true only in this order.
    expect(rowsStored('seed-')).toEqual([
      { key: 'seed-first', value: 'true' },
      { key: 'seed-second', value: 'true' },
    ]);
  });

  test('a second run of idempotent seeds runs them again and writes nothing new', async () => {
    await runSeeds(db, join(FIXTURES, 'ordered'));
    expect(await runSeeds(db, join(FIXTURES, 'ordered'))).toEqual(['01-first.ts', '02-second.ts']);
    expect(rowsStored('seed-')).toHaveLength(2);
  });

  test('a missing folder runs nothing and writes nothing', async () => {
    const before = db.$client.query<{ count: number }, []>('select count(*) as count from app_config').get();
    expect(await runSeeds(db, join(FIXTURES, 'absent'))).toEqual([]);
    expect(db.$client.query<{ count: number }, []>('select count(*) as count from app_config').get()).toEqual(before);
  });

  test('stops at the first failing seed, naming it, with its error as the cause', async () => {
    const failure = await runSeeds(db, join(FIXTURES, 'failing')).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SeedFailedError);
    const seedFailure = failure as SeedFailedError;
    expect(seedFailure.file).toBe('02-throws.ts');
    expect(seedFailure.message).toBe('seed 02-throws.ts failed');
    expect((seedFailure.cause as Error).message).toBe('seed fixture fails on purpose');
  });

  test('keeps the seeds before the failure, rolls the failing one back and runs none after it', async () => {
    await runSeeds(db, join(FIXTURES, 'failing')).catch(() => undefined);

    expect(rowsStored('fail-').map((row) => row.key)).toEqual(['fail-good']);
  });

  test('control: the failing seed\'s write lands when it runs outside a transaction', async () => {
    await expect(throwingSeed(db)).rejects.toThrow('seed fixture fails on purpose');

    expect(rowsStored('fail-').map((row) => row.key)).toEqual(['fail-partial']);
  });

  test('a file with no seed export fails as that seed', async () => {
    const failure = await runSeeds(db, join(FIXTURES, 'no-export')).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SeedFailedError);
    expect((failure as SeedFailedError).file).toBe('01-empty.ts');
  });

  test('a misnamed file stops the run before any seed', async () => {
    await expect(runSeeds(db, join(FIXTURES, 'misnamed'))).rejects.toThrow(SeedNameError);
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
    const fault = Object.assign(new Error('secret statement'), { code: 'SQLITE_CONSTRAINT' });

    const exitCode = await seedCommand({ seed: async () => { throw new SeedFailedError('02-b.ts', fault); }, close: async () => {}, log });

    expect(exitCode).toBe(1);
    expect(records).toEqual([
      expect.objectContaining({ level: 'error', domain: 'Db', scope: 'seed', step: 'run', seed: '02-b.ts', code: 'SQLITE_CONSTRAINT', msg: 'seed failed' }),
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

describe('bun run db:seed as a child process', () => {
  const repoRoot = resolve(import.meta.dir, '..', '..');
  const tempRoot = join(repoRoot, '.temp');
  let workDir: string;

  beforeAll(() => {
    mkdirSync(tempRoot, { recursive: true });
    workDir = mkdtempSync(join(tempRoot, 'seed-cli-'));
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** Runs `bun run <script>` from the repo root against `databaseFile`, and collects its output. */
  async function runScript(script: string, databaseFile: string): Promise<{ output: string; exitCode: number }> {
    const child = Bun.spawn(['bun', 'run', script], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: `file:${databaseFile}` },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { output: stdout + stderr, exitCode };
  }

  test('exits 0 and logs that it ran the seeds in src/data/seeds/ on a migrated database', async () => {
    // Arrange
    expect(listSeeds()).toEqual(['01-companies.ts']);
    const databaseFile = join(workDir, 'seed.sqlite');
    const migrated = await runScript('db:migrate', databaseFile);
    expect(migrated.exitCode).toBe(0);

    // Act
    const seeded = await runScript('db:seed', databaseFile);

    // Assert
    expect(seeded.exitCode).toBe(0);
    expect(seeded.output).toContain('ran seeds');
    expect(seeded.output).toContain('01-companies.ts');
  }, 30_000);
});
