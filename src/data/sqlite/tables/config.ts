import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { NOW_SECONDS } from './auth.ts';

/**
 * App-level settings as key and JSON value, such as the backup settings under the key
 * `backup`. The value is JSON text with no CHECK on it, so which keys exist and what each holds
 * is decided by the code that reads the key, and adding a setting never changes the table.
 */
export const appConfig = sqliteTable('app_config', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
    .default(NOW_SECONDS),
});
