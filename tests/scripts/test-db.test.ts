import type { PlanInput, SuitePlan, SuiteResult } from '../../scripts/test-db.ts';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import packageJson from '../../package.json' with { type: 'json' };
import {
  expandGlobs,
  formatSuiteLine,
  parseBunTestCounts,
  PG_BUILD_SUITE,
  planTestDb,
  POSTGRES_DIRECT_FILES,
  POSTGRES_SUITE,
  probePostgres,
  PROJECT_ROOT,
  runSuite,
  SQLITE_SUITE,
  suiteEnv,
  suiteFailed,
  suiteFilesUnder,
  testDbExitCode,
} from '../../scripts/test-db.ts';

/** Files standing in for each suite's expansion, so the plan's tests read no tree. */
const FILES: PlanInput['files'] = {
  [SQLITE_SUITE]: ['tests/data/seed.test.ts'],
  [PG_BUILD_SUITE]: ['tests/data/pg/index.test.ts'],
  [POSTGRES_SUITE]: ['tests/mcp/bulk.test.ts'],
};

/** An import of `describePg` from the gate module, which every gated test file holds. */
const DESCRIBE_PG_IMPORT = /^import \{[^}]*\bdescribePg\b[^}]*\} from '[./]+\/support\/pg-gate\.ts';$/m;

/** The summary `bun test` printed for a run with one skip, copied from a real run. */
const SUMMARY = '\n 20 pass\n 1 skip\n 0 fail\n 34 expect() calls\nRan 21 tests across 2 files. [627.00ms]\n';

const scratch: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
});

/** A fresh directory that `afterEach` removes. */
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'test-db-'));
  scratch.push(dir);
  return dir;
}

/** A local port nothing listens on, so a connection to it is refused at once. */
async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((ready) => probe.listen(0, '127.0.0.1', () => ready()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** A local server that accepts connections and never answers, so `select 1` waits forever. */
async function silentPort(): Promise<number> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => void sockets.push(socket));
  server.on('close', () => sockets.forEach((socket) => socket.destroy()));
  const closing = server.close.bind(server);
  server.close = (callback) => {
    sockets.forEach((socket) => socket.destroy());
    return closing(callback);
  };
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', () => ready()));
  return (server.address() as AddressInfo).port;
}

/** The suite of `plan` named `name`. */
function suiteOf(suites: readonly SuitePlan[], name: string): SuitePlan | undefined {
  return suites.find((suite) => suite.name === name);
}

describe('planTestDb', () => {
  test('the SQLite build without TEST_PG_URL runs the SQLite suite and names why the others are out', () => {
    // Act
    const plan = planTestDb({ dialect: 'sqlite', postgres: { state: 'unset' }, files: FILES });

    // Assert: the Postgres-direct files join the SQLite suite, without the URL, for their
    // server-free blocks.
    expect(plan.suites).toEqual([
      { name: 'sqlite', run: true, files: ['tests/data/seed.test.ts', 'tests/mcp/bulk.test.ts'], withPgUrl: false },
      { name: 'pg-build', run: false, reason: 'the active dialect is sqlite' },
      { name: 'postgres', run: false, reason: 'TEST_PG_URL is not set' },
    ]);
    expect(plan.missingActiveDatabase).toBeUndefined();
  });

  test('the SQLite build with an answering Postgres also runs the Postgres-direct suite with the URL', () => {
    // Act
    const plan = planTestDb({ dialect: 'sqlite', postgres: { state: 'answered' }, files: FILES });

    // Assert
    expect(suiteOf(plan.suites, SQLITE_SUITE)).toEqual({ name: 'sqlite', run: true, files: FILES[SQLITE_SUITE], withPgUrl: false });
    expect(suiteOf(plan.suites, POSTGRES_SUITE)).toEqual({ name: 'postgres', run: true, files: FILES[POSTGRES_SUITE], withPgUrl: true });
    expect(suiteOf(plan.suites, PG_BUILD_SUITE)).toEqual({ name: 'pg-build', run: false, reason: 'the active dialect is sqlite' });
    expect(plan.missingActiveDatabase).toBeUndefined();
  });

  test('the SQLite build with a silent Postgres gives the probe reason and still exists', () => {
    // Arrange
    const reason = 'select 1 did not answer within 2 seconds';

    // Act
    const plan = planTestDb({ dialect: 'sqlite', postgres: { state: 'silent', reason }, files: FILES });

    // Assert
    expect(suiteOf(plan.suites, POSTGRES_SUITE)).toEqual({ name: 'postgres', run: false, reason });
    expect(suiteOf(plan.suites, SQLITE_SUITE)).toEqual({ name: 'sqlite', run: true, files: ['tests/data/seed.test.ts', 'tests/mcp/bulk.test.ts'], withPgUrl: false });
    expect(plan.missingActiveDatabase).toBeUndefined();
  });

  test('a Postgres-direct file already in the SQLite suite is listed once', () => {
    // Arrange
    const files = { ...FILES, [SQLITE_SUITE]: ['tests/mcp/bulk.test.ts', 'tests/data/seed.test.ts'] };

    // Act
    const plan = planTestDb({ dialect: 'sqlite', postgres: { state: 'unset' }, files });

    // Assert
    expect(suiteOf(plan.suites, SQLITE_SUITE)).toEqual({ name: 'sqlite', run: true, files: ['tests/data/seed.test.ts', 'tests/mcp/bulk.test.ts'], withPgUrl: false });
  });

  test('the SQLite build over the real tree without a server runs every Postgres-direct file in the SQLite suite', () => {
    // Act
    const plan = planTestDb({ dialect: 'sqlite', postgres: { state: 'unset' }, files: suiteFilesUnder() });

    // Assert
    const sqlite = suiteOf(plan.suites, SQLITE_SUITE);
    expect(sqlite?.run).toBe(true);
    expect(sqlite?.run === true
      ? sqlite.files
      : []).toEqual(expect.arrayContaining([...POSTGRES_DIRECT_FILES, 'tests/data/seed.test.ts']));
  });

  test('the Postgres build with an answering server runs its suite and the Postgres-direct one', () => {
    // Act
    const plan = planTestDb({ dialect: 'pg', postgres: { state: 'answered' }, files: FILES });

    // Assert
    expect(plan.suites).toEqual([
      { name: 'sqlite', run: false, reason: 'the active dialect is pg' },
      { name: 'pg-build', run: true, files: FILES[PG_BUILD_SUITE], withPgUrl: true },
      { name: 'postgres', run: true, files: FILES[POSTGRES_SUITE], withPgUrl: true },
    ]);
    expect(plan.missingActiveDatabase).toBeUndefined();
  });

  test('the Postgres build with no server runs nothing and names the missing database', () => {
    // Act
    const plan = planTestDb({ dialect: 'pg', postgres: { state: 'unset' }, files: FILES });

    // Assert
    expect(plan.suites.every((suite) => !suite.run)).toBe(true);
    expect(suiteOf(plan.suites, PG_BUILD_SUITE)).toEqual({ name: 'pg-build', run: false, reason: 'TEST_PG_URL is not set' });
    expect(plan.missingActiveDatabase).toBe('the active dialect is pg and Postgres does not exist: TEST_PG_URL is not set');
    expect(testDbExitCode(plan, [])).toBe(1);
  });

  test('a suite whose patterns match no file is left out with that reason', () => {
    // Arrange
    const files = { ...FILES, [SQLITE_SUITE]: [] };

    // Act
    const plan = planTestDb({ dialect: 'sqlite', postgres: { state: 'answered' }, files });

    // Assert
    expect(suiteOf(plan.suites, SQLITE_SUITE)).toEqual({ name: 'sqlite', run: false, reason: 'no test file matches its patterns' });
  });
});

describe('parseBunTestCounts', () => {
  test('reads the pass, fail and skip lines of a summary', () => {
    expect(parseBunTestCounts(SUMMARY)).toEqual({ pass: 20, fail: 0, skip: 1 });
  });

  test('counts a missing skip line as 0', () => {
    expect(parseBunTestCounts(' 3 pass\n 2 fail\n')).toEqual({ pass: 3, fail: 2, skip: 0 });
  });

  test('reads a summary wrapped in colour escapes', () => {
    expect(parseBunTestCounts('\u001b[32m 4 pass\u001b[0m\n\u001b[31m 1 fail\u001b[0m\n')).toEqual({ pass: 4, fail: 1, skip: 0 });
  });

  test('reads no count from a test name that holds the words mid-line', () => {
    expect(parseBunTestCounts('(pass) prints 3 pass\n(pass) prints 0 fail\n')).toBeUndefined();
  });

  test('returns undefined when the fail line is missing', () => {
    expect(parseBunTestCounts(' 3 pass\n')).toBeUndefined();
  });
});

describe('suiteFailed and testDbExitCode', () => {
  const plan = planTestDb({ dialect: 'sqlite', postgres: { state: 'unset' }, files: FILES });
  const passed: SuiteResult = { name: 'sqlite', fileCount: 1, exitCode: 0, counts: { pass: 2, fail: 0, skip: 0 } };

  test('a clean run passes and the command exits 0', () => {
    expect(suiteFailed(passed)).toBe(false);
    expect(testDbExitCode(plan, [passed])).toBe(0);
  });

  test('a non-zero exit fails the suite even when no failure was counted', () => {
    const errored = { ...passed, exitCode: 1 };
    expect(suiteFailed(errored)).toBe(true);
    expect(testDbExitCode(plan, [passed, errored])).toBe(1);
  });

  test('a counted failure fails the suite even with exit 0', () => {
    expect(suiteFailed({ ...passed, counts: { pass: 2, fail: 1, skip: 0 } })).toBe(true);
  });

  test('a summary that could not be read fails the suite', () => {
    expect(suiteFailed({ ...passed, counts: undefined })).toBe(true);
  });
});

describe('formatSuiteLine', () => {
  test('names a suite left out and why', () => {
    expect(formatSuiteLine({ name: 'postgres', run: false, reason: 'TEST_PG_URL is not set' })).toBe('postgres: not run, TEST_PG_URL is not set');
  });

  test('names a suite that ran with its file count, counts and exit code', () => {
    // Arrange
    const result: SuiteResult = { name: 'sqlite', fileCount: 12, exitCode: 0, counts: { pass: 80, fail: 0, skip: 2 } };

    // Act and assert
    expect(formatSuiteLine(result)).toBe('sqlite: ran 12 files, 80 pass, 0 fail, 2 skip, exit 0');
    expect(formatSuiteLine({ ...result, fileCount: 1, exitCode: 1, counts: undefined })).toBe('sqlite: ran 1 file, counts not read from its output, exit 1');
  });
});

describe('suiteEnv', () => {
  const env = { PATH: '/bin', TEST_PG_URL: 'postgres://u:p@h/d' };

  test('drops TEST_PG_URL for a suite that needs no server and leaves the parent as it was', () => {
    // Act
    const child = suiteEnv({ name: 'sqlite', run: true, files: [], withPgUrl: false }, env);

    // Assert
    expect(child).toEqual({ PATH: '/bin' });
    expect(env.TEST_PG_URL).toBe('postgres://u:p@h/d');
  });

  test('passes TEST_PG_URL through to a suite that takes it', () => {
    expect(suiteEnv({ name: 'postgres', run: true, files: [], withPgUrl: true }, env)).toEqual(env);
  });
});

describe('probePostgres', () => {
  test('reports unset when TEST_PG_URL is missing or empty', async () => {
    expect(await probePostgres({})).toEqual({ state: 'unset' });
    expect(await probePostgres({ TEST_PG_URL: '' })).toEqual({ state: 'unset' });
  });

  test('names a refused connection by its code and never repeats the URL', async () => {
    // Arrange
    const env = { TEST_PG_URL: `postgres://u:hunter2@127.0.0.1:${await unusedPort()}/d` };

    // Act
    const probe = await probePostgres(env, 1000);

    // Assert
    expect(probe).toEqual({ state: 'silent', reason: 'select 1 failed with ECONNREFUSED' });
    expect(JSON.stringify(probe)).not.toContain('hunter2');
  });

  test('gives up on a server that accepts and never answers', async () => {
    // Arrange
    const env = { TEST_PG_URL: `postgres://u:p@127.0.0.1:${await silentPort()}/d` };
    const started = Date.now();

    // Act
    const probe = await probePostgres(env, 200);

    // Assert
    expect(probe).toEqual({ state: 'silent', reason: 'select 1 did not answer within 0.2 seconds' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('the suite constants against the tree', () => {
  test('the Postgres-direct files are exactly the test files that import describePg', () => {
    // Arrange
    const testFiles = expandGlobs(['tests/**/*.test.ts', 'tests/**/*.test.tsx'], []);
    const gated = testFiles.filter((file) => !file.startsWith('tests/support/')
      && DESCRIBE_PG_IMPORT.test(readFileSync(join(PROJECT_ROOT, file), 'utf8')));

    // Assert
    expect(gated.length).toBeGreaterThan(0);
    expect(gated).toEqual([...POSTGRES_DIRECT_FILES].sort());
  });

  test('every Postgres-direct file exists', () => {
    for (const file of POSTGRES_DIRECT_FILES) expect(existsSync(join(PROJECT_ROOT, file))).toBe(true);
  });

  test('the SQLite suite holds the server-free database tests and no Postgres-direct file', () => {
    // Act
    const files = suiteFilesUnder();

    // Assert
    expect(files[SQLITE_SUITE]).toEqual(expect.arrayContaining([
      'tests/data/journal.test.ts',
      'tests/data/seed.test.ts',
      'tests/data/sqlite/client.test.ts',
      'tests/repositories/config.test.ts',
      'tests/support/sqlite-db.test.ts',
    ]));
    expect(files[SQLITE_SUITE].filter((file) => POSTGRES_DIRECT_FILES.includes(file))).toEqual([]);
    expect(files[SQLITE_SUITE]).not.toContain('tests/data/pg/index.test.ts');
    expect(files[PG_BUILD_SUITE]).toEqual(expect.arrayContaining(['tests/data/pg/index.test.ts', 'tests/repositories/config.test.ts']));
    expect(files[POSTGRES_SUITE]).toEqual([...POSTGRES_DIRECT_FILES]);
  });

  test('a route repository test is found by glob for both builds', () => {
    // Arrange
    const root = scratchDir();
    mkdirSync(join(root, 'tests/routes/notes'), { recursive: true });
    writeFileSync(join(root, 'tests/routes/notes/repository.test.ts'), '');
    writeFileSync(join(root, 'tests/routes/notes/http.test.ts'), '');

    // Act
    const files = suiteFilesUnder(root);

    // Assert
    expect(files[SQLITE_SUITE]).toEqual(['tests/routes/notes/repository.test.ts']);
    expect(files[PG_BUILD_SUITE]).toEqual(['tests/routes/notes/repository.test.ts']);
  });

  test('package.json runs this script as test:db', () => {
    expect(packageJson.scripts['test:db']).toBe('bun scripts/test-db.ts');
  });
});

describe('runSuite', () => {
  test('forwards the child output, passes each file as a path and reads the exit code and counts', async () => {
    // Arrange: a stand-in for `bun test` that echoes what it was given and fails.
    const dir = scratchDir();
    const fake = join(dir, 'fake-bun-test.ts');
    writeFileSync(fake, [
      'console.log(JSON.stringify({ args: process.argv.slice(2), url: process.env.TEST_PG_URL ?? null }));',
      'console.error(" 2 pass\\n 1 fail");',
      'process.exit(1);',
    ].join('\n'));
    const chunks: string[] = [];
    const sink = { write: (chunk: Uint8Array) => chunks.push(new TextDecoder().decode(chunk)) };

    // Act
    const result = await runSuite(
      { name: 'sqlite', run: true, files: ['tests/a.test.ts', 'tests/b.test.ts'], withPgUrl: false },
      { command: [process.execPath, fake], cwd: dir, env: { PATH: process.env.PATH, TEST_PG_URL: 'postgres://x' }, stdout: sink, stderr: sink },
    );

    // Assert
    expect(result).toEqual({ name: 'sqlite', fileCount: 2, exitCode: 1, counts: { pass: 2, fail: 1, skip: 0 } });
    expect(suiteFailed(result)).toBe(true);
    const output = chunks.join('');
    expect(output).toContain(JSON.stringify({ args: ['./tests/a.test.ts', './tests/b.test.ts'], url: null }));
    expect(output).toContain(' 1 fail');
  });
});
