import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * App-level settings as key and JSON value, such as the backup settings under the key
 * `backup`. The value is jsonb with no CHECK on it, so which keys exist and what each holds is
 * decided by the code that reads the key, and adding a setting never changes the table.
 */
export const appConfig = pgTable('app_config', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
    .defaultNow(),
});
