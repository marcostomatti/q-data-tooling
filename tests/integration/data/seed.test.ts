import type { TestDatabase } from '../../support/test-db.ts';

import { join, resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { listSeeds, runSeeds, SeedFailedError, SeedNameError } from '../../../src/data/seed.ts';
import { seed as throwingSeed } from '../../data/fixtures/seeds/failing/02-throws.ts';
import { openTestDatabase } from '../../support/test-db.ts';

/** The seed folders the tests run, kept beside the unit tests of `listSeeds`, which read them too. */
const FIXTURES = join(import.meta.dir, '..', '..', 'data', 'fixtures', 'seeds');

let database: TestDatabase;

beforeAll(async () => {
  database = await openTestDatabase();
});

beforeEach(async () => {
  await database.reset();
});

afterAll(async () => {
  await database.close();
});

/** The `app_config` rows whose key starts with `prefix`, as key and stored JSON value, sorted by key. */
async function rowsStored(prefix: string): Promise<{ key: string; value: unknown }[]> {
  return database.sql<{ key: string; value: unknown }[]>`select key, value from app_config where key like ${`${prefix}%`} order by key`;
}

/** How many `app_config` rows there are, read with SQL. */
async function configCount(): Promise<number> {
  const [row] = await database.sql<{ count: number }[]>`select count(*)::int as count from app_config`;
  return row?.count ?? -1;
}

describe('runSeeds', () => {
  test('runs every seed in order and returns their names', async () => {
    expect(await runSeeds(database.db, join(FIXTURES, 'ordered'))).toEqual(['01-first.ts', '02-second.ts']);

    // `seed-second` holds whether `seed-first` was there when it ran: true only in this order.
    expect(await rowsStored('seed-')).toEqual([
      { key: 'seed-first', value: true },
      { key: 'seed-second', value: true },
    ]);
  });

  test('a second run of idempotent seeds runs them again and writes nothing new', async () => {
    await runSeeds(database.db, join(FIXTURES, 'ordered'));
    expect(await runSeeds(database.db, join(FIXTURES, 'ordered'))).toEqual(['01-first.ts', '02-second.ts']);
    expect(await rowsStored('seed-')).toHaveLength(2);
  });

  test('a missing folder runs nothing and writes nothing', async () => {
    const before = await configCount();
    expect(await runSeeds(database.db, join(FIXTURES, 'absent'))).toEqual([]);
    expect(await configCount()).toBe(before);
  });

  test('stops at the first failing seed, naming it, with its error as the cause', async () => {
    const failure = await runSeeds(database.db, join(FIXTURES, 'failing')).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SeedFailedError);
    const seedFailure = failure as SeedFailedError;
    expect(seedFailure.file).toBe('02-throws.ts');
    expect(seedFailure.message).toBe('seed 02-throws.ts failed');
    expect((seedFailure.cause as Error).message).toBe('seed fixture fails on purpose');
  });

  test('keeps the seeds before the failure, rolls the failing one back and runs none after it', async () => {
    await runSeeds(database.db, join(FIXTURES, 'failing')).catch(() => undefined);

    expect((await rowsStored('fail-')).map((row) => row.key)).toEqual(['fail-good']);
  });

  test('control: the failing seed\'s write lands when it runs outside a transaction', async () => {
    await expect(throwingSeed(database.db)).rejects.toThrow('seed fixture fails on purpose');

    expect((await rowsStored('fail-')).map((row) => row.key)).toEqual(['fail-partial']);
  });

  test('a file with no seed export fails as that seed', async () => {
    const failure = await runSeeds(database.db, join(FIXTURES, 'no-export')).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SeedFailedError);
    expect((failure as SeedFailedError).file).toBe('01-empty.ts');
  });

  test('a misnamed file stops the run before any seed', async () => {
    await expect(runSeeds(database.db, join(FIXTURES, 'misnamed'))).rejects.toThrow(SeedNameError);
  });
});

describe('bun run db:seed as a child process', () => {
  const repoRoot = resolve(import.meta.dir, '..', '..', '..');

  /** Runs `bun run <script>` from the repo root against the scratch database, and collects its output. */
  async function runScript(script: string): Promise<{ output: string; exitCode: number }> {
    const child = Bun.spawn(['bun', 'run', script], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: database.url },
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
    // Arrange: `openTestDatabase` has applied every migration to the scratch database.
    expect(listSeeds()).toEqual(['01-companies.ts']);

    // Act
    const seeded = await runScript('db:seed');

    // Assert
    expect(seeded.exitCode).toBe(0);
    expect(seeded.output).toContain('ran seeds');
    expect(seeded.output).toContain('01-companies.ts');
    const [companies] = await database.sql<{ count: number }[]>`select count(*)::int as count from companies`;
    expect(companies?.count).toBeGreaterThan(0);
  }, 30_000);
});
