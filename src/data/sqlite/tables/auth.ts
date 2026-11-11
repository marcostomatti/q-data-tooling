import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * The SQL default for a timestamp column: the current time in whole seconds since the epoch,
 * which is what `integer(..., { mode: 'timestamp' })` stores. `current_timestamp` would not do:
 * it is text, and Drizzle reads it back as an invalid date.
 */
export const NOW_SECONDS = sql`(unixepoch())`;

/**
 * One row per signed-in browser. The cookie carries a random id; only its SHA-256 is stored,
 * so a copy of the table (a backup, say) cannot be replayed as a cookie. A session ends when
 * `expires_at` passes, when the user signs out (the row is deleted), or when
 * `bun run reset-credentials` empties the table.
 */
export const authSession = sqliteTable('auth_session', {
  idHash: text('id_hash').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
    .default(NOW_SECONDS),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

/**
 * A named API token a signed-in user minted for an agent or an HTTP client. The token is shown
 * once at creation; only its SHA-256 is kept, beside the first characters (`prefix`) so the list
 * can tell two tokens apart. Revoking sets `revoked_at` and keeps the row, so the list still
 * shows what existed; `bun run reset-credentials` deletes every row.
 */
export const apiToken = sqliteTable('api_token', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  tokenHash: text('token_hash').notNull()
    .unique(),
  prefix: text().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
    .default(NOW_SECONDS),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});
