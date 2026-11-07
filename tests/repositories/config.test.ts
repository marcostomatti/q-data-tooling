import type { Log } from '../../src/logging.ts';
import type { SqliteTestClient } from '../support/sqlite-db.ts';

import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';

import { BackupSettingsPatchSchema, BackupSettingsSchema } from '../../src/backup/contract.ts';
import { BACKUP_DEFAULTS, readBackupSettings, setBackupSettings } from '../../src/data/repositories/config.ts';
import { inDomain, scoped } from '../../src/logging.ts';
import { thrownBy } from '../data/rolled-back.ts';
import { captureLog, type LogRecord } from '../support/capture-log.ts';
import { openMigratedMemoryDb } from '../support/sqlite-db.ts';

/** A log for the calls whose logging a test does not look at. */
const silent: Log = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

/** A log that records what it is told, so a fallback can be seen rather than assumed. */
function spyLogger(): { readonly logger: Log; readonly logged: readonly LogRecord[] } {
  const { log, records } = captureLog();
  return { logger: log, logged: records };
}

/** Runs `body` on a fresh migrated `:memory:` database and closes it after, whatever `body` does. */
async function withMemoryDb<T>(body: (db: SqliteTestClient) => Promise<T>): Promise<T> {
  const db = openMigratedMemoryDb();
  try {
    return await body(db);
  } finally {
    db.$client.close();
  }
}

/**
 * Writes raw text as the stored value, the way a person editing the table by hand would. It goes
 * through `$client` SQL, so the text is stored as given, JSON or not.
 */
function handEdit(db: SqliteTestClient, key: string, rawText: string): void {
  db.$client.run(
    'insert into app_config (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
    [key, rawText],
  );
}

type StoredRow = { readonly value: string; readonly updated_at: number };

/** The stored row under `key`, read with SQL so the check sees what is in the table. */
function storedRow(db: SqliteTestClient, key: string): StoredRow | null {
  return db.$client.query<StoredRow, [string]>('select value, updated_at from app_config where key = ?').get(key);
}

describe('readBackupSettings and setBackupSettings', () => {
  test('returns the defaults when nothing is stored, without logging', async () => {
    // Arrange
    const { logger, logged } = spyLogger();

    // Act
    const settings = await withMemoryDb((db) => readBackupSettings(db, logger));

    // Assert
    expect(settings).toEqual(BACKUP_DEFAULTS);
    expect(BACKUP_DEFAULTS).toEqual({ enabled: true, keep: 1, intervalDays: 14 });
    expect(logged).toEqual([]);
  });

  test('turns backups off with one setting and keeps the rest at their defaults', async () => {
    // Arrange / Act
    const { written, read } = await withMemoryDb(async (db) => {
      const written = await setBackupSettings(db, { enabled: false }, silent);
      return { written, read: await readBackupSettings(db, silent) };
    });

    // Assert
    expect(written).toEqual({ ...BACKUP_DEFAULTS, enabled: false });
    expect(read).toEqual(written);
  });

  test('merges a patch over what is stored, so a second patch does not undo the first', async () => {
    // Arrange / Act
    const read = await withMemoryDb(async (db) => {
      await setBackupSettings(db, { keep: 3 }, silent);
      await setBackupSettings(db, { intervalDays: 7 }, silent);
      return readBackupSettings(db, silent);
    });

    // Assert
    expect(read).toEqual({ enabled: true, keep: 3, intervalDays: 7 });
  });

  test('reads a hand-written partial object field by field, filling the gaps silently', async () => {
    // Arrange
    const { logger, logged } = spyLogger();

    // Act
    const read = await withMemoryDb(async (db) => {
      handEdit(db, 'backup', '{"keep": 4}');
      return readBackupSettings(db, logger);
    });

    // Assert
    expect(read).toEqual({ enabled: true, keep: 4, intervalDays: 14 });
    expect(logged).toEqual([]);
  });

  test('keeps a valid enabled: false when another field is invalid', async () => {
    // Arrange
    const { logger, logged } = spyLogger();

    // Act
    const read = await withMemoryDb(async (db) => {
      handEdit(db, 'backup', '{"enabled": false, "keep": 0, "intervalDays": "weekly"}');
      return readBackupSettings(db, logger);
    });

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

    // Act
    const read = await withMemoryDb(async (db) => {
      handEdit(db, 'backup', `{"enabled": ${literal}}`);
      return readBackupSettings(db, logger);
    });

    // Assert
    expect(read.enabled).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ key: 'backup', fields: ['enabled'] });
  });

  test('stores exactly the three settings when handed a wider object', async () => {
    // Arrange
    const wide = { keep: 2, directory: '/somewhere', extra: { nested: true } };

    // Act
    const { stored, returned } = await withMemoryDb(async (db) => {
      const returned = await setBackupSettings(db, wide as never, silent);
      const row = storedRow(db, 'backup');
      return { stored: row
        ? (JSON.parse(row.value) as unknown)
        : undefined, returned };
    });

    // Assert
    expect(stored).toEqual({ enabled: true, keep: 2, intervalDays: 14 });
    expect(returned).toEqual(stored as typeof returned);
  });

  test('refuses a keep of 0 or NaN that skipped the patch schema, and stores nothing', async () => {
    // Arrange / Act
    const { zero, notANumber, row } = await withMemoryDb(async (db) => {
      const zero = await thrownBy(() => setBackupSettings(db, { keep: 0 }, silent));
      const notANumber = await thrownBy(() => setBackupSettings(db, { keep: Number.NaN }, silent));
      return { zero, notANumber, row: storedRow(db, 'backup') };
    });

    // Assert
    expect(zero).toBeInstanceOf(ZodError);
    expect(notANumber).toBeInstanceOf(ZodError);
    expect(row).toBeNull();
  });

  test('hands out a copy of the defaults, so mutating a result cannot change the next read', async () => {
    // Arrange / Act
    const { first, second } = await withMemoryDb(async (db) => {
      const first = (await readBackupSettings(db, silent)) as { keep: number };
      first.keep = 99;
      return { first, second: await readBackupSettings(db, silent) };
    });

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

    // Act
    const read = await withMemoryDb(async (db) => {
      handEdit(db, 'backup', literal);
      return readBackupSettings(db, logger);
    });

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
    await withMemoryDb(async (db) => {
      handEdit(db, 'backup', '"daily"');
      await readBackupSettings(db, logger);
      handEdit(db, 'backup', JSON.stringify(long));
      return readBackupSettings(db, logger);
    });

    // Assert
    expect(logged[0]).toMatchObject({ key: 'backup', stored: 'daily' });
    const stored = String(logged[1]?.stored);
    expect(stored.length).toBeLessThan(200);
  });

  test('logs a fallback as its own step on the log the caller passes, under the caller\'s domain and scope', async () => {
    // Arrange: the caller's log carries a domain and a scope, as the backup run's does.
    const { log, records } = captureLog();
    const callerLog = scoped(inDomain(log, 'Backup'), 'run');

    // Act
    const read = await withMemoryDb(async (db) => {
      handEdit(db, 'backup', '"daily"');
      return readBackupSettings(db, callerLog);
    });

    // Assert
    expect(read).toEqual(BACKUP_DEFAULTS);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ domain: 'Backup', scope: 'run', step: 'parseSettings', level: 'warn', key: 'backup' });
  });

  test('logs a field fallback as the same step on the caller\'s log', async () => {
    // Arrange
    const { log, records } = captureLog();
    const callerLog = scoped(inDomain(log, 'Backup'), 'start');

    // Act
    await withMemoryDb(async (db) => {
      handEdit(db, 'backup', '{"keep": 0}');
      return readBackupSettings(db, callerLog);
    });

    // Assert
    expect(records).toEqual([expect.objectContaining({ domain: 'Backup', scope: 'start', step: 'parseSettings', fields: ['keep'] })]);
  });

  test('falls back to the defaults and logs when the stored text is not JSON at all', async () => {
    // Arrange
    const { logger, logged } = spyLogger();

    // Act
    const read = await withMemoryDb(async (db) => {
      handEdit(db, 'backup', 'daily');
      return readBackupSettings(db, logger);
    });

    // Assert
    expect(read).toEqual(BACKUP_DEFAULTS);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ key: 'backup', stored: 'unparseable JSON' });
  });

  test('stamps updated_at with the time of each write, on insert and on conflict', async () => {
    // Arrange: a stale stamp, so a write that left updated_at alone would be seen.
    const stale = 1000;
    const before = Math.floor(Date.now() / 1000);

    // Act
    const stamps = await withMemoryDb(async (db) => {
      await setBackupSettings(db, { keep: 2 }, silent);
      const inserted = storedRow(db, 'backup')?.updated_at;
      db.$client.run('update app_config set updated_at = ? where key = ?', [stale, 'backup']);
      const staled = storedRow(db, 'backup')?.updated_at;
      await setBackupSettings(db, { keep: 3 }, silent);
      return { inserted, staled, updated: storedRow(db, 'backup')?.updated_at };
    });

    // Assert
    expect(stamps.inserted).toBeGreaterThanOrEqual(before);
    expect(stamps.staled).toBe(stale);
    expect(stamps.updated).toBeGreaterThanOrEqual(before);
  });

  test('repairs an odd stored value when a patch is written over it', async () => {
    // Arrange
    const { logger, logged } = spyLogger();

    // Act
    const read = await withMemoryDb(async (db) => {
      handEdit(db, 'backup', '"daily"');
      await setBackupSettings(db, { keep: 2 }, logger);
      return readBackupSettings(db, logger);
    });

    // Assert
    expect(read).toEqual({ enabled: true, keep: 2, intervalDays: 14 });
    expect(logged).toHaveLength(1);
  });
});

describe('the backup schemas', () => {
  test('keep must be a whole number of at least one, because zero would mean no backups at all', () => {
    expect(BackupSettingsSchema.shape.keep.safeParse(0).success).toBe(false);
    expect(BackupSettingsSchema.shape.keep.safeParse(1.5).success).toBe(false);
    expect(BackupSettingsSchema.shape.keep.safeParse(2).success).toBe(true);
  });

  test('the interval is a whole number of days, at least one', () => {
    expect(BackupSettingsSchema.shape.intervalDays.safeParse(0).success).toBe(false);
    expect(BackupSettingsSchema.shape.intervalDays.safeParse(0.5).success).toBe(false);
    expect(BackupSettingsSchema.shape.intervalDays.safeParse(Infinity).success).toBe(false);
    expect(BackupSettingsSchema.shape.intervalDays.safeParse(14).success).toBe(true);
  });

  test('a patch names at least one field, refuses a field it does not know, and takes numbers only as numbers', () => {
    expect(BackupSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(BackupSettingsPatchSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(BackupSettingsPatchSchema.safeParse({ keep: 2, directory: '/tmp' }).success).toBe(false);
    expect(BackupSettingsPatchSchema.safeParse({ enabled: 'false' }).success).toBe(false);
    expect(BackupSettingsPatchSchema.safeParse({ keep: '2' }).success).toBe(false);
  });
});
