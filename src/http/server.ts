import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createService, type ServiceHandle } from '@open-tomato/service-express';
import express from 'express';

import { APP } from '../app-config.ts';
import { requireApiAccess } from '../auth/access.ts';
import { GENERATED_KEY_LENGTH } from '../auth/api-key.ts';
import { parseAuthConfig, type AuthConfig } from '../auth/config.ts';
import { authRouter } from '../auth/routes.ts';
import { DEFAULT_BACKUP_DIR, startBackupSchedule, type BackupWiring } from '../backup/schedule.ts';
import { dbDependency, getDb } from '../data/active.ts';
import { inDomain, lazyLogger, scoped, type Log } from '../logging.ts';
import { mountRoutes } from '../routes/http.ts';
import { createSecClient } from '../sec/client.ts';
import { readSecUserAgent } from '../sec/config.ts';

const MAX_PORT = 65_535;

/** The domain the service's start lines carry; each is written under scope `start`. */
const DOMAIN = 'Server';

/** The base log for a schedule that cannot start when its wiring names none, built on first use. */
const backupLogger = lazyLogger('backup');

/**
 * The request budget per window. The chassis default is 100 a minute, and a board that loads
 * several routes at once, or is reloaded a few times in a row, would meet it and read a 429 as
 * a fault. 1,000 a minute is about 17 a second: far above one person's use, and still a bound.
 * The limit is not the defence against guessing the key, which is long and random.
 */
const RATE_LIMIT = { max: 1_000, windowMs: 60_000 } as const;

/** Where `bun run build:web` writes the web app. */
const DEFAULT_WEB_DIST = resolve(import.meta.dir, '../web/dist');

/** The paths the web app draws itself, each answered with its `index.html`: `/` lands on `APP.landing.path`. */
export const APP_PATHS = ['/', '/login', APP.landing.path, '/companies', '/tokens'];

export interface StartOptions {
  /**
   * The port to listen on. Defaults to `PORT`, then the chassis's 3000; under `NODE_ENV=test`
   * with neither set, the chassis binds a port the OS picks. A taken port falls back to the next
   * free one with a warning. The MCP server's HTTP mode takes 8080 and 3001.
   */
  readonly port?: number
  /** The directory holding the built web app. Defaults to `src/web/dist`; nothing is served when it does not exist. */
  readonly webDist?: string
  /**
   * Starts the backup schedule with these options. Left unset, the schedule runs in the default
   * `backups/` directory, except under `NODE_ENV=test`, where nothing is started so no test ever
   * spawns a dump. A test of the wiring passes its own, with a stand-in for `pg_dump`.
   */
  readonly backup?: BackupWiring
  /**
   * The base log the start lines are written to, under domain `Server` and scope `start`.
   * Defaults to the chassis's service logger; a test passes a capturing fake.
   */
  readonly log?: Log
}

/** Thrown before anything is opened when neither an API key nor a login is configured. Its message carries no key. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      'Neither API_KEY nor AUTH_MODE is set, so nothing could open /api and the service will not start. Run ' +
        '`bun run setApiKey --burn-after-reading` to write an API_KEY into .env, or set AUTH_MODE (see docs/auth.md).',
    );
    this.name = 'MissingApiKeyError';
  }
}

/**
 * The key clients may present, or `undefined` when only a login (and the tokens it mints) opens
 * `/api`. With neither, the service refuses to start, and never runs open, because
 * `createService` listens on every network interface and takes no host: with nothing checked,
 * every route (writes included) would be reachable from any machine on the network.
 */
function configuredApiKey(env: NodeJS.ProcessEnv, auth: AuthConfig): string | undefined {
  const key = env.API_KEY;
  const hasKey = key !== undefined && key !== '';
  if (!hasKey && auth.mode === 'none') throw new MissingApiKeyError();
  return hasKey
    ? key
    : undefined;
}

/** Refuses anything but a whole number from 1 to 65,535. `what` names the setting in the message. */
function assertPort(port: number, what: string): number {
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`${what} must be a whole number from 1 to ${MAX_PORT}`);
  }
  return port;
}

/**
 * The port option to hand the chassis: the caller's, else undefined. A port that is not a port
 * number is refused before anything opens, `PORT` included, but `PORT` is left for the chassis to
 * read itself: the chassis names the setting a port came from when that port is taken, so a
 * `PORT` passed on as the option would send the operator to `port`, which only code can set.
 */
function resolvePort(requested: number | undefined, env: NodeJS.ProcessEnv): number | undefined {
  if (requested !== undefined) return assertPort(requested, 'the port option');
  const raw = env.PORT;
  if (raw !== undefined && raw !== '') assertPort(Number(raw), 'PORT');
  return undefined;
}

/**
 * Whether the key is shorter than one `setApiKey` makes. Short keys are allowed, because a
 * hand-edited `.env` is the user's to write and a floor is a policy choice, but a short key on
 * a service bound to every interface is worth a warning. Only the comparison is made here: the
 * key and its length are never returned or logged.
 */
function isShorterThanGenerated(key: string): boolean {
  return key.length < GENERATED_KEY_LENGTH;
}

/**
 * The backup options to start the schedule with, or `undefined` for none. A caller's own win;
 * otherwise the defaults, except under `NODE_ENV=test`.
 */
export function backupOptionsFor(env: NodeJS.ProcessEnv, requested: BackupWiring | undefined): BackupWiring | undefined {
  if (requested !== undefined) return requested;
  return env.NODE_ENV === 'test'
    ? undefined
    : {};
}

type BackupHandle = { stop(): Promise<void> };

/**
 * Starts the schedule and returns at once with the promise for its handle. It is not awaited
 * by the caller: the schedule's first check can run a full dump, and a cold start a fortnight
 * after the last backup must not hold the service back behind it. A schedule that cannot
 * start is logged by error name only, and the service runs without it.
 */
function startBackups(db: ReturnType<typeof getDb>, wiring: BackupWiring | undefined): Promise<BackupHandle | undefined> {
  if (wiring === undefined) return Promise.resolve(undefined);
  return startBackupSchedule({ ...wiring, db: wiring.db ?? db, outDir: wiring.outDir ?? DEFAULT_BACKUP_DIR }).catch((error: unknown) => {
    const log = scoped(inDomain(wiring.logger ?? backupLogger(), DOMAIN), 'start');
    log.error({ step: 'startBackups', reason: error instanceof Error
      ? error.name
      : 'unknown' }, 'the backup schedule did not start');
    return undefined;
  });
}

/**
 * Starts the internal HTTP service: the chassis (health, body parser, rate limit, error
 * handler), the `/auth` routes, the credential check on `/api`, the routes in `ROUTES`, and the web
 * bundle when one exists.
 *
 * Auth is only `requireApiAccess` (the API key, a minted token, or a session cookie). The
 * chassis's `auth` is left unset and `ctx.requireAuth` is never mounted,
 * because with no auth service configured the chassis's `requireAuth` allows every request.
 * `cors` is unset too: the app and the API share one origin and one port.
 */
export async function startService(opts: StartOptions = {}): Promise<ServiceHandle> {
  // All are read before anything opens, so a wrong setting stops the start with its own message.
  // The SEC User-Agent goes first: without it no filings sync could succeed, whatever opens /api.
  // The one SEC client is built here and shared by every route, so its spacing covers them all.
  const sec = createSecClient({ fetch, userAgent: readSecUserAgent(process.env) });
  const auth = parseAuthConfig(process.env);
  const apiKey = configuredApiKey(process.env, auth);
  const port = resolvePort(opts.port, process.env);
  const webDist = opts.webDist ?? DEFAULT_WEB_DIST;
  const db = getDb();

  const service = await createService({
    serviceId: APP.id,
    ...(port === undefined
      ? {}
      : { port }),
    rateLimit: RATE_LIMIT,
    dependencies: [dbDependency(db)],
    register: (app, { logger }) => {
      const log = scoped(inDomain(opts.log ?? logger, DOMAIN), 'start');
      if (apiKey !== undefined && isShorterThanGenerated(apiKey)) {
        log.warn(
          { step: 'checkKey' },
          'API_KEY is shorter than the keys `bun run setApiKey` makes, and the service listens on every ' +
            'network interface; run `bun run setApiKey --burn-after-reading` to replace it with a strong one.',
        );
      }
      app.use('/auth', authRouter(db, auth));
      app.use('/api', requireApiAccess(db, apiKey));
      mountRoutes(app, db, undefined, auth.mode, sec);
      if (existsSync(webDist)) {
        app.use(express.static(webDist));
        // The app routes in the browser, so a reload on /tokens or the landing page gets the page and not a 404.
        // The bundle directory is the `root`, not part of the path: `send` refuses a path with a
        // dot-folder in it (a clone under `.claude/worktrees`, say) and would answer 404.
        app.get(APP_PATHS, (_req, res) => res.sendFile('index.html', { root: webDist }));
      } else {
        log.info({ step: 'serveWeb', webDist: 'absent' }, 'no web bundle found; serving the API only');
      }
    },
  });
  // Started once the server is listening, and not awaited (see `startBackups`).
  const backups = startBackups(db, backupOptionsFor(process.env, opts.backup));
  return {
    ...service,
    // The schedule stops first, while the database it reads settings from is still open.
    stop: async () => {
      await (await backups)?.stop();
      await service.stop();
    },
  };
}

if (import.meta.main) {
  startService().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error
      ? error.message
      : String(error)}\n`);
    process.exit(1);
  });
}
