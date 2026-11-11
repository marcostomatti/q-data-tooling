import { createDependency, type TypedDependency } from '@open-tomato/service-express';
import { sql } from 'drizzle-orm';

import { inDomain, lazyLogger, scoped, type Log } from '../../logging.ts';
import { faultCode } from '../driver-faults.ts';

import { closeDb, type DrizzleClient } from './client.ts';

/** The name the chassis shows for this dependency in its logs and health report. */
export const SQLITE_DEPENDENCY_NAME = 'sqlite';

/** The logger a failed start goes to unless the caller names one; built only when a start fails. */
const serverLog = lazyLogger('server');

/** The domain a failed ping is logged under; the scope is `ping`, so its line is signed `Db:ping`. */
const DOMAIN = 'Db';

/**
 * The chassis dependency for the SQLite database. Starting it runs `select 1` on `db`, so a
 * database that cannot be read stops the service before it listens; stopping it closes the
 * process-wide connection (see {@link closeDb}).
 *
 * A failed start is logged by the driver's code alone (see {@link faultCode}), then the
 * connection is closed and an error naming what to check is thrown in place of the driver's.
 *
 * @param db - The client the service's routes use; the dependency exposes it as `client`.
 * @param log - The base log a failed start is written to, signed `Db:ping` with step `ping`.
 *   Defaults to the `server` logger.
 */
export function sqliteDependency(db: DrizzleClient, log?: Log): TypedDependency<DrizzleClient> {
  return createDependency({
    name: SQLITE_DEPENDENCY_NAME,
    client: db,
    onStart: async () => {
      try {
        db.run(sql`select 1`);
      } catch (error: unknown) {
        const logger = scoped(inDomain(log ?? serverLog(), DOMAIN), 'ping');
        logger.error({ step: 'ping', code: faultCode(error) }, 'database unreachable');
        await closeDb();
        throw new Error(
          'the database is unreachable; check that DATABASE_URL names a SQLite file this process can write',
          { cause: error },
        );
      }
    },
    onStop: closeDb,
  });
}
