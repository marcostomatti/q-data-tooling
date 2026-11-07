import type { Db } from './db.ts';
import type { Log } from '../../logging.ts';

import { eq } from 'drizzle-orm';

import { BackupSettingsSchema, type BackupSettings, type BackupSettingsPatch } from '../../backup/contract.ts';
import { isRecord } from '../../guards.ts';
import { appConfig } from '../active.ts';

import { pickDefined } from './pick-defined.ts';

/** The `app_config` key this module owns. */
const BACKUP_KEY = 'backup';

/**
 * The step a fallback warning carries. A repository holds no logger of its own: it logs on the
 * `Log` its caller passes, which carries the caller's domain and scope, so the warning reads as
 * one step of the caller's workflow.
 */
const FALLBACK_STEP = 'parseSettings';

/**
 * Backups on, one dump kept (each replaces the last rather than accumulating) and a
 * fortnight apart. Backups are the one place this layer carries a default, because `backup`
 * settings are the app's own behaviour and not the user's judgement.
 */
export const BACKUP_DEFAULTS: Readonly<BackupSettings> = Object.freeze({ enabled: true, keep: 1, intervalDays: 14 });

/** The columns of the stored settings a patch may name, in one place. */
const BACKUP_FIELDS = ['enabled', 'keep', 'intervalDays'] as const satisfies readonly (keyof BackupSettings)[];

/** The longest stored string a log line repeats; a hand-edited value can be any length. */
const LOGGED_VALUE_MAX = 80;

/**
 * What a read yields for a stored value that is not JSON at all. Postgres's jsonb refuses such a
 * value on write, but SQLite keeps the value as text with no CHECK, so a hand edit can store one,
 * and the driver's `JSON.parse` then throws a `SyntaxError` on read.
 */
const UNPARSEABLE = Symbol('unparseable JSON');

/** What a stored value looks like, without repeating all of it: a short string whole, anything else by type. */
function describeStored(value: unknown): string {
  if (value === UNPARSEABLE) return 'unparseable JSON';
  if (typeof value === 'string') return value.slice(0, LOGGED_VALUE_MAX);
  if (value === null) return 'null';
  return Array.isArray(value)
    ? 'array'
    : typeof value;
}

/**
 * The stored value under `key`, `null` when nothing is stored, or `UNPARSEABLE` when the stored
 * text is not JSON. Only a `SyntaxError` is read as unparseable; any other error is the
 * database's and is thrown.
 */
async function readStored(db: Db, key: string): Promise<{ readonly value: unknown } | null> {
  try {
    const [row] = await db.select({ value: appConfig.value }).from(appConfig)
      .where(eq(appConfig.key, key));
    return row ?? null;
  } catch (error) {
    if (error instanceof SyntaxError) return { value: UNPARSEABLE };
    throw error;
  }
}

/**
 * Stores `value` under `key`, replacing what is there. `updatedAt` is `now`, bound as a parameter
 * rather than a SQL `now()`, which only Postgres has, so the one statement runs on either dialect.
 */
async function writeStored(db: Db, key: string, value: unknown, now: Date = new Date()): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: now } });
}

type FieldReading<K extends keyof BackupSettings> = { readonly value: BackupSettings[K]; readonly valid: boolean };

/**
 * One backup field from a stored object: the stored value when it fits, the default when it
 * is absent (`valid`) or does not fit (not `valid`). Reading field by field means one bad
 * field cannot cost the others, so a valid stored `enabled: false` survives a bad `keep`.
 * A bad `enabled` itself reads as `true`, on purpose: for a backup, running when the setting
 * cannot be read is the data-safe failure, and the log names the field.
 */
function readField<K extends keyof BackupSettings>(stored: Readonly<Record<string, unknown>>, key: K): FieldReading<K> {
  if (!(key in stored)) return { value: BACKUP_DEFAULTS[key], valid: true };
  const parsed = BackupSettingsSchema.shape[key].safeParse(stored[key]);
  return parsed.success
    ? { value: parsed.data as BackupSettings[K], valid: true }
    : { value: BACKUP_DEFAULTS[key], valid: false };
}

/**
 * The backup settings, with a default for anything absent. `app_config.backup` is JSON (jsonb on
 * Postgres, text on SQLite) with no CHECK and a person may edit it by hand, so the stored value is
 * untrusted: a stored value that is not an object, or on SQLite not JSON at all, yields the
 * defaults, a field that does not fit yields that field's default, and both are logged on `log`,
 * the caller's, with step `parseSettings`. A fresh install, with nothing stored, yields the
 * defaults silently.
 */
export async function readBackupSettings(db: Db, log: Log): Promise<Readonly<BackupSettings>> {
  const stored = await readStored(db, BACKUP_KEY);
  if (!stored) return { ...BACKUP_DEFAULTS };
  if (!isRecord(stored.value)) {
    log.warn({ step: FALLBACK_STEP, key: BACKUP_KEY, stored: describeStored(stored.value) }, 'unusable backup settings in app_config; using the defaults');
    return { ...BACKUP_DEFAULTS };
  }
  const readings = {
    enabled: readField(stored.value, 'enabled'),
    keep: readField(stored.value, 'keep'),
    intervalDays: readField(stored.value, 'intervalDays'),
  };
  const invalid = Object.entries(readings).flatMap(([field, reading]) => (reading.valid
    ? []
    : [field]));
  if (invalid.length > 0) {
    log.warn({ step: FALLBACK_STEP, key: BACKUP_KEY, fields: invalid }, 'unusable backup settings in app_config; those fields use their defaults');
  }
  return { enabled: readings.enabled.value, keep: readings.keep.value, intervalDays: readings.intervalDays.value };
}

/**
 * Changes the named backup settings and keeps the rest as they read now, then stores and
 * returns the whole. `{ enabled: false }` is therefore the one setting that turns backups
 * off. The write is built from the three named fields only, so a wider object that carries
 * another key at runtime cannot add it to the stored JSON, and the merged whole is parsed
 * against `BackupSettingsSchema` before it is stored, so a `keep` of 0 or `NaN` that skipped
 * the patch schema is refused here (a `ZodError`) instead of stored.
 *
 * The read, the merge and the write are not locked: two concurrent patches read the same
 * stored object and the later write wins, losing the other's change. That is accepted for a
 * single-user app and recorded here so it is not discovered later. The read's fallback
 * warnings go to `log`, as {@link readBackupSettings} says.
 */
export async function setBackupSettings(
  db: Db,
  patch: BackupSettingsPatch,
  log: Log,
): Promise<BackupSettings> {
  const current = await readBackupSettings(db, log);
  const merged = BackupSettingsSchema.parse({ ...current, ...pickDefined(patch, BACKUP_FIELDS) });
  await writeStored(db, BACKUP_KEY, merged);
  return merged;
}
