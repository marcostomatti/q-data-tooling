import { createDependency, type TypedDependency } from '@open-tomato/service-express';
import { sql } from 'drizzle-orm';

import { inDomain, lazyLogger, scoped, type Log } from '../../logging.ts';
import { faultCode } from '../driver-faults.ts';

import { closeDb, type DrizzleClient } from './client.ts';

/** The name the chassis shows for this dependency in its logs and health report. */
export const POSTGRES_DEPENDENCY_NAME = 'postgres';

/** The logger a failed start goes to unless the caller names one; built only when a start fails. */
const serverLog = lazyLogger('server');

/** The domain a failed ping is logged under; the scope is `ping`, so its line is signed `Db:ping`. */
const DOMAIN = 'Db';

/**
 * The Postgres pool as a chassis dependency, so it is started before the server listens and
 * stopped after the server has drained. Starting it runs `select 1` on `db`, so a database that
 * is down stops the service at startup and not at the first request; stopping it closes the
 * process-wide pool (see {@link closeDb}).
 *
 * The chassis exits with only the dependency's name in the log, so a failed start is logged
 * here, by the driver's code alone (see {@link faultCode}) and never by its message, which can
 * carry the connection's address. The pool is then closed and an error naming what to check is
 * thrown in place of the driver's.
 *
 * @param db - The client the service's routes use; the dependency exposes it as `client`.
 * @param log - The base log a failed start is written to, signed `Db:ping` with step `ping`.
 *   Defaults to the `server` logger.
 */
export function postgresDependency(db: DrizzleClient, log?: Log): TypedDependency<DrizzleClient> {
  return createDependency({
    name: POSTGRES_DEPENDENCY_NAME,
    client: db,
    onStart: async () => {
      try {
        await db.execute(sql`select 1`);
      } catch (error: unknown) {
        const logger = scoped(inDomain(log ?? serverLog(), DOMAIN), 'ping');
        logger.error({ step: 'ping', code: faultCode(error) }, 'database unreachable');
        await closeDb();
        throw new Error('the database is unreachable; check DATABASE_URL and that Postgres is running', { cause: error });
      }
    },
    onStop: closeDb,
  });
}
