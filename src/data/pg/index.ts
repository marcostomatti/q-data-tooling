/**
 * The Postgres dialect: its client, its chassis dependency and its schema. Every dialect's
 * folder exports these same names, so code that imports the active dialect reads one surface
 * whichever dialect is built.
 *
 * @module
 */

/** Which dialect this folder is, so code that must differ by dialect (the backup dump) can ask. */
export const DIALECT = 'pg';

export { closeDb, getDb, type DrizzleClient } from './client.ts';
export { transact } from './transaction.ts';
export { postgresDependency as dbDependency } from './dependency.ts';
export { apiToken, authSession } from './tables/auth.ts';
export { companies } from './tables/companies.ts';
export { appConfig } from './tables/config.ts';
