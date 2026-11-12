import type { Log } from '../../../src/logging.ts';
import type { TestDatabase } from '../../support/test-db.ts';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';

import { BACKUP_DEFAULTS, readBackupSettings, setBackupSettings } from '../../../src/data/repositories/config.ts';
import { inDomain, scoped } from '../../../src/logging.ts';
import { thrownBy } from '../../data/rolled-back.ts';
import { captureLog, type LogRecord } from '../../support/capture-log.ts';
import { openTestDatabase } from '../../support/test-db.ts';

/** A log for the calls whose logging a test does not look at. */
const silent: Log = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

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

/** A log that records what it is told, so a fallback can be seen rather than assumed. */
function spyLogger(): { readonly logger: Log; readonly logged: readonly LogRecord[] } {
  const { log, records } = captureLog();
  return { logger: log, logged: records };
}

/**
 * Writes raw JSON text as the stored value, the way a person editing the table by hand would. It
 * goes through SQL and the `jsonb` cast, so the text is stored as given, whatever its shape.
 */
async function handEdit(key: string, rawText: string): Promise<void> {
  await database.sql`
    insert into app_config (key, value) values (${key}, ${rawText}::jsonb)
    on conflict (key) do update set value = excluded.value`;
}

/** A stored row: its value, and its `updated_at` in epoch milliseconds. */
type StoredRow = { readonly value: unknown; readonly updated_ms: number };

/**
 * The stored row under `key`, read with SQL so the check sees what is in the table. `updated_at`
 * is read as epoch milliseconds, because the drizzle client sharing this connection makes the
 * driver hand timestamps back as text.
 */
async function storedRow(key: string): Promise<StoredRow | null> {
  const [row] = await database.sql<StoredRow[]>`
    select value, (extract(epoch from updated_at) * 1000)::float8 as updated_ms from app_config where key = ${key}`;
  return row ?? null;
}

describe('readBackupSettings and setBackupSettings', () => {
  test('returns the defaults when nothing is stored, without logging', async () => {
    // Arrange
    const { logger, logged } = spyLogger();

    // Act
    const settings = await readBackupSettings(database.db, logger);

    // Assert
    expect(settings).toEqual(BACKUP_DEFAULTS);
    expect(BACKUP_DEFAULTS).toEqual({ enabled: true, keep: 1, intervalDays: 14 });
    expect(logged).toEqual([]);
  });

  test('turns backups off with one setting and keeps the rest at their defaults', async () => {
    // Arrange / Act
    const written = await setBackupSettings(database.db, { enabled: false }, silent);
    const read = await readBackupSettings(database.db, silent);

    // Assert
    expect(written).toEqual({ ...BACKUP_DEFAULTS, enabled: false });
    expect(read).toEqual(written);
  });

  test('merges a patch over what is stored, so a second patch does not undo the first', async () => {
    // Arrange / Act
    await setBackupSettings(database.db, { keep: 3 }, silent);
    await setBackupSettings(database.db, { intervalDays: 7 }, silent);
    const read = await readBackupSettings(database.db, silent);

    // Assert
    expect(read).toEqual({ enabled: true, keep: 3, intervalDays: 7 });
  });

  test('reads a hand-written partial object field by field, filling the gaps silently', async () => {
    // Arrange
    const { logger, logged } = spyLogger();
    await handEdit('backup', '{"keep": 4}');

    // Act
    const read = await readBackupSettings(database.db, logger);

    // Assert
    expect(read).toEqual({ enabled: true, keep: 4, intervalDays: 14 });
    expect(logged).toEqual([]);
  });

  test('keeps a valid enabled: false when another field is invalid', async () => {
    // Arrange
    const { logger, logged } = spyLogger();
    await handEdit('backup', '{"enabled": false, "keep": 0, "intervalDays": "weekly"}');

    // Act
    const read = await readBackupSettings(database.db, logger);

    // Assert
    expect(read).toEqual({ enabled: false, keep: 1, intervalDays: 14 });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ key: 'backup', fields: ['keep', 'intervalDays'] });
  });

  test.each([
    ['the text "false"', '"false"'],
    ['the number 0', '0'],
  ])('reads an invalid enabled (%s) as on and logs the field, because running is the safe direction', async (_label, literal) => {
    // Arrange
    const { logger, logged } = spyLogger();
    await handEdit('backup', `{"enabled": ${literal}}`);

    // Act
    const read = await readBackupSettings(database.db, logger);

    // Assert
    expect(read.enabled).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ key: 'backup', fields: ['enabled'] });
  });

  test('stores exactly the three settings when handed a wider object', async () => {
    // Arrange
    const wide = { keep: 2, directory: '/somewhere', extra: { nested: true } };

    // Act
    const returned = await setBackupSettings(database.db, wide as never, silent);
    const stored = (await storedRow('backup'))?.value;

    // Assert
    expect(stored).toEqual({ enabled: true, keep: 2, intervalDays: 14 });
    expect(returned).toEqual(stored as typeof returned);
  });

  test('refuses a keep of 0 or NaN that skipped the patch schema, and stores nothing', async () => {
    // Arrange / Act
    const zero = await thrownBy(() => setBackupSettings(database.db, { keep: 0 }, silent));
    const notANumber = await thrownBy(() => setBackupSettings(database.db, { keep: Number.NaN }, silent));
    const row = await storedRow('backup');

    // Assert
    expect(zero).toBeInstanceOf(ZodError);
    expect(notANumber).toBeInstanceOf(ZodError);
    expect(row).toBeNull();
  });

  test('hands out a copy of the defaults, so mutating a result cannot change the next read', async () => {
    // Arrange / Act
    const first = (await readBackupSettings(database.db, silent)) as { keep: number };
    first.keep = 99;
    const second = await readBackupSettings(database.db, silent);

    // Assert
    expect(first.keep).toBe(99);
    expect(second.keep).toBe(1);
    expect(BACKUP_DEFAULTS.keep).toBe(1);
    expect(Object.isFrozen(BACKUP_DEFAULTS)).toBe(true);
  });

  test.each([
    ['a number', '5'],
    ['a string', '"daily"'],
    ['an array', '[1]'],
    ['a JSON null', 'null'],
  ])('falls back to the defaults and logs when the stored value is %s', async (_label, literal) => {
    // Arrange
    const { logger, logged } = spyLogger();
    await handEdit('backup', literal);

    // Act
    const read = await readBackupSettings(database.db, logger);

    // Assert
    expect(read).toEqual(BACKUP_DEFAULTS);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ key: 'backup' });
  });

  test('names a short stored string in the log, and does not echo a long one whole', async () => {
    // Arrange
    const { logger, logged } = spyLogger();
    const long = 'x'.repeat(5000);

    // Act
    await handEdit('backup', '"daily"');
    await readBackupSettings(database.db, logger);
    await handEdit('backup', JSON.stringify(long));
    await readBackupSettings(database.db, logger);

    // Assert
    expect(logged[0]).toMatchObject({ key: 'backup', stored: 'daily' });
    const stored = String(logged[1]?.stored);
    expect(stored.length).toBeLessThan(200);
  });

  test('logs a fallback as its own step on the log the caller passes, under the caller\'s domain and scope', async () => {
    // Arrange: the caller's log carries a domain and a scope, as the backup run's does.
    const { log, records } = captureLog();
    const callerLog = scoped(inDomain(log, 'Backup'), 'run');
    await handEdit('backup', '"daily"');

    // Act
    const read = await readBackupSettings(database.db, callerLog);

    // Assert
    expect(read).toEqual(BACKUP_DEFAULTS);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ domain: 'Backup', scope: 'run', step: 'parseSettings', level: 'warn', key: 'backup' });
  });

  test('logs a field fallback as the same step on the caller\'s log', async () => {
    // Arrange
    const { log, records } = captureLog();
    const callerLog = scoped(inDomain(log, 'Backup'), 'start');
    await handEdit('backup', '{"keep": 0}');

    // Act
    await readBackupSettings(database.db, callerLog);

    // Assert
    expect(records).toEqual([expect.objectContaining({ domain: 'Backup', scope: 'start', step: 'parseSettings', fields: ['keep'] })]);
  });

  test('a hand edit that is not JSON at all is refused by the jsonb column, so a read finds nothing stored', async () => {
    // Arrange
    const { logger, logged } = spyLogger();

    // Act
    const refused = await thrownBy(() => handEdit('backup', 'daily'));
    const read = await readBackupSettings(database.db, logger);

    // Assert: Postgres's invalid_text_representation, and nothing to fall back from.
    expect(refused).toMatchObject({ code: '22P02' });
    expect(await storedRow('backup')).toBeNull();
    expect(read).toEqual(BACKUP_DEFAULTS);
    expect(logged).toEqual([]);
  });

  test('stamps updated_at with the time of each write, on insert and on conflict', async () => {
    // Arrange: a stale stamp, so a write that left updated_at alone would be seen.
    const stale = new Date('2000-01-01T00:00:00Z');
    const before = Date.now();

    // Act
    await setBackupSettings(database.db, { keep: 2 }, silent);
    const inserted = (await storedRow('backup'))?.updated_ms;
    await database.sql`update app_config set updated_at = ${stale.toISOString()}::timestamptz where key = 'backup'`;
    const staled = (await storedRow('backup'))?.updated_ms;
    await setBackupSettings(database.db, { keep: 3 }, silent);
    const updated = (await storedRow('backup'))?.updated_ms;

    // Assert
    expect(inserted).toBeGreaterThanOrEqual(before);
    expect(staled).toBe(stale.getTime());
    expect(updated).toBeGreaterThanOrEqual(before);
  });

  test('repairs an odd stored value when a patch is written over it', async () => {
    // Arrange
    const { logger, logged } = spyLogger();
    await handEdit('backup', '"daily"');

    // Act
    await setBackupSettings(database.db, { keep: 2 }, logger);
    const read = await readBackupSettings(database.db, logger);

    // Assert
    expect(read).toEqual({ enabled: true, keep: 2, intervalDays: 14 });
    expect(logged).toHaveLength(1);
  });
});
