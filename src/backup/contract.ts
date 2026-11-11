import { z } from 'zod';

/** The most backups kept or days between them a caller may ask for; far past any real use. */
const BACKUP_COUNT_MAX = 1000;

/**
 * How backups behave, stored whole under `app_config.backup`. `keep` is at least one because
 * zero would mean no backup at all, and that is what `enabled: false` is for. The interval
 * is in whole days: a fortnight is 14, and finer timing has no use for a dump of personal data.
 */
export const BackupSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  keep: z.number().int()
    .min(1)
    .max(BACKUP_COUNT_MAX),
  intervalDays: z.number().int()
    .min(1)
    .max(BACKUP_COUNT_MAX),
});

export type BackupSettings = z.infer<typeof BackupSettingsSchema>;

/** A change to the backup settings: any of the three, never none. */
export const BackupSettingsPatchSchema = BackupSettingsSchema.partial().refine(
  (patch) => Object.values(patch).some((value) => value !== undefined),
  { message: 'a patch must name at least one setting to change' },
);

export type BackupSettingsPatch = z.infer<typeof BackupSettingsPatchSchema>;
