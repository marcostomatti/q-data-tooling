import type { AuthConfig } from './config.ts';
import type { Db } from '../data/repositories/db.ts';

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import { answerTraceId, REQUEST_ID_HEADER, sendFailure } from '../http/handler.ts';
import { inDomain, lazyLogger, scoped, TRACE_ID_FIELD, type Log } from '../logging.ts';

import { liveSessionId } from './access.ts';
import { createdToken, createTokenInput, loginInput, sessionState, signInState, tokenIdParam, tokenSummary } from './contract.ts';
import { CSRF_HEADER, OIDC_COOKIE, readCookie, SAFE_METHODS, SESSION_COOKIE, setCookie, wantsSecureCookie } from './cookies.ts';
import { LoginThrottle } from './login-throttle.ts';
import { newPendingLogin, OidcClient, OidcLoginError, type PendingLogin } from './oidc.ts';
import { verifyPassword } from './password-hash.ts';
import {
  cookieSecret,
  createSession,
  createToken,
  deleteSession,
  listTokens,
  revokeToken,
  SESSION_DAYS,
  sign,
  unsign,
} from './store.ts';

const defaultLogger = lazyLogger('auth');

/**
 * The domain every auth line carries. The scope is the route's workflow: `session`, `login`,
 * `callback`, `logout` or `tokens`.
 */
const DOMAIN = 'Auth';

const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/** An OIDC attempt has ten minutes to come back from the provider. */
const OIDC_MAX_AGE = 10 * 60;
const OIDC_COOKIE_PATH = '/auth/oidc';

/** Where the browser lands after signing in, and where a refused OIDC sign-in is sent. */
const HOME = '/';
const LOGIN_FAILED = '/login?error=oidc';

function fail(res: Response, status: number, name: string, message: string): void {
  res.status(status).json({ success: false, error: { name, message } });
}

/** Answers every auth request's trace id before any route can answer, refusals included. */
const traceRequest: RequestHandler = (req, res, next) => {
  answerTraceId(req, res);
  next();
};

/** `log` with the trace id `traceRequest` answered on this response bound as `traceId`. */
function traced(res: Response, log: Log): Log {
  return log.child({ [TRACE_ID_FIELD]: res.getHeader(REQUEST_ID_HEADER) });
}

/**
 * Answers an error a route threw, as `sendFailure` does. A 500 is logged signed
 * `Auth:<scope>` with `step`, under the request's trace id, so it joins the request's other lines.
 */
function failRoute(res: Response, error: unknown, log: Log, scope: string, step: string): void {
  sendFailure(res, error, scoped(traced(res, log), scope), { step });
}

/** Refuses an unsafe method without the CSRF header, so another site cannot sign this browser in or out. */
const requireCsrfHeader: RequestHandler = (req, res, next) => {
  if (!SAFE_METHODS.has(req.method) && req.get(CSRF_HEADER) !== '1') {
    fail(res, 403, 'Forbidden', `this request must send the ${CSRF_HEADER} header`);
    return;
  }
  next();
};

/**
 * The token routes' guard: lets a request through only with a live session, because token
 * management is for a person, never for a token. A failed check is signed `Auth:tokens`.
 */
function requireSession(db: Db, log: () => Log): RequestHandler {
  return async (req, res, next) => {
    try {
      if ((await liveSessionId(req, db)) !== undefined) return next();
      fail(res, 401, 'Unauthorized', 'sign in first');
    } catch (error: unknown) {
      failRoute(res, error, log(), 'tokens', 'checkSession');
    }
  };
}

async function startSession(req: Request, res: Response, db: Db): Promise<void> {
  const id = await createSession(db);
  setCookie(res, SESSION_COOKIE, sign(id, await cookieSecret(db)), {
    maxAge: SESSION_MAX_AGE,
    path: '/',
    secure: wantsSecureCookie(req),
  });
}

/** A JSON body's fields, or none when the body is not an object, so a missing body reads as a missing field. */
function bodyFields(body: unknown): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body
    : {};
}

/** The 400 message for a refused body: an unknown field is named, any other refusal is `field`'s. */
function bodyRefusal(error: z.ZodError, field: string, fieldMessage: string): string {
  const unknown = error.issues.find((issue) => issue.code === 'unrecognized_keys');
  return unknown === undefined
    ? `${field}: ${fieldMessage}`
    : `body: ${unknown.message}`;
}

function passwordLogin(db: Db, passwordHash: string, throttle: LoginThrottle, log: () => Log): RequestHandler {
  return async (req, res) => {
    const body = loginInput.safeParse(bodyFields(req.body));
    if (!body.success) return fail(res, 400, 'ValidationError', bodyRefusal(body.error, 'password', 'a password is required'));
    const retryAfter = throttle.begin();
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      fail(res, 429, 'TooManyAttempts', `too many wrong passwords; try again in ${retryAfter} seconds`);
      return;
    }
    try {
      if (!(await verifyPassword(body.data.password, passwordHash))) {
        return fail(res, 401, 'Unauthorized', 'wrong password');
      }
      throttle.succeeded();
      await startSession(req, res, db);
      res.json({ success: true, data: signInState.parse({ signedIn: true }) });
    } catch (error: unknown) {
      failRoute(res, error, log(), 'login', 'signIn');
    }
  };
}

const PendingShape = z.object({ state: z.string(), nonce: z.string(), verifier: z.string() });

/** The pending OIDC attempt in this browser's signed cookie, or `undefined` when there is none or it was tampered with. */
function readPending(req: Request, secret: string): PendingLogin | undefined {
  const signed = readCookie(req, OIDC_COOKIE);
  const json = signed === undefined
    ? undefined
    : unsign(signed, secret);
  if (json === undefined) return undefined;
  try {
    const parsed = PendingShape.safeParse(JSON.parse(json));
    return parsed.success
      ? parsed.data
      : undefined;
  } catch {
    return undefined;
  }
}

function oidcRoutes(router: Router, db: Db, client: OidcClient, log: () => Log): void {
  router.get('/oidc/start', async (req, res) => {
    try {
      const pending = newPendingLogin();
      const url = await client.authorizationUrl(pending);
      setCookie(res, OIDC_COOKIE, sign(JSON.stringify(pending), await cookieSecret(db)), {
        maxAge: OIDC_MAX_AGE,
        path: OIDC_COOKIE_PATH,
        secure: wantsSecureCookie(req),
      });
      res.redirect(302, url);
    } catch (error: unknown) {
      scoped(traced(res, log()), 'login').error({
        step: 'authorize',
        reason: error instanceof OidcLoginError
          ? error.reason
          : 'unknown',
      }, 'OIDC sign-in could not start');
      res.redirect(302, LOGIN_FAILED);
    }
  });

  router.get('/oidc/callback', async (req, res) => {
    // The attempt is single-use: its cookie is cleared whether the callback succeeds or not.
    setCookie(res, OIDC_COOKIE, '', { maxAge: 0, path: OIDC_COOKIE_PATH, secure: wantsSecureCookie(req) });
    try {
      const pending = readPending(req, await cookieSecret(db));
      const code = typeof req.query.code === 'string'
        ? req.query.code
        : undefined;
      if (pending === undefined) throw new OidcLoginError('no sign-in attempt is pending in this browser');
      if (req.query.state !== pending.state) throw new OidcLoginError('the state does not match');
      if (code === undefined) throw new OidcLoginError('the provider sent no code');
      await client.completeLogin({ code, pending });
      await startSession(req, res, db);
      res.redirect(302, HOME);
    } catch (error: unknown) {
      scoped(traced(res, log()), 'callback').warn({
        step: 'completeLogin',
        reason: error instanceof OidcLoginError
          ? error.reason
          : 'unknown',
      }, 'OIDC sign-in refused');
      res.redirect(302, LOGIN_FAILED);
    }
  });
}

function tokenRoutes(router: Router, db: Db, log: () => Log): void {
  const session = requireSession(db, log);
  router.get('/tokens', session, async (_req, res) => {
    try {
      res.json({ success: true, data: tokenSummary.array().parse(await listTokens(db)) });
    } catch (error: unknown) {
      failRoute(res, error, log(), 'tokens', 'listTokens');
    }
  });
  router.post('/tokens', session, async (req, res) => {
    const body = createTokenInput.safeParse(bodyFields(req.body));
    if (!body.success) {
      const nameIssue = body.error.issues.find((issue) => issue.path[0] === 'name');
      return fail(res, 400, 'ValidationError', bodyRefusal(body.error, 'name', nameIssue?.message ?? 'a token needs a name'));
    }
    try {
      res.status(201).json({ success: true, data: createdToken.parse(await createToken(db, body.data.name)) });
    } catch (error: unknown) {
      failRoute(res, error, log(), 'tokens', 'createToken');
    }
  });
  router.delete('/tokens/:id', session, async (req, res) => {
    const params = tokenIdParam.safeParse(req.params);
    if (!params.success) return fail(res, 400, 'ValidationError', 'id: must be a positive whole number');
    try {
      res.json({ success: true, data: tokenSummary.parse(await revokeToken(db, params.data.id)) });
    } catch (error: unknown) {
      failRoute(res, error, log(), 'tokens', 'revokeToken');
    }
  });
}

/** What the routes need beyond the database. A test passes its own OIDC client, throttle and log. */
export interface AuthRouteOptions {
  readonly oidcClient?: OidcClient
  readonly throttle?: LoginThrottle
  /**
   * The base log the routes write to; they bind domain `Auth`, the request's `traceId` and the
   * route's scope on it. Defaults to the `auth` logger, built on the first line.
   */
  readonly log?: Log
}

/**
 * The `/auth` routes: which mode is on and whether this browser is signed in, the sign-in for
 * that mode, sign-out, and the API token list. Every reply answers the request's trace id in
 * `x-request-id`, and every unsafe method needs the CSRF header.
 */
export function authRouter(db: Db, config: AuthConfig, options: AuthRouteOptions = {}): Router {
  const router = Router();
  const authLog = (): Log => inDomain(options.log ?? defaultLogger(), DOMAIN);
  router.use(traceRequest);
  router.use(requireCsrfHeader);

  router.get('/session', async (req, res) => {
    try {
      const signedIn = config.mode !== 'none' && (await liveSessionId(req, db)) !== undefined;
      res.json({ success: true, data: sessionState.parse({ mode: config.mode, signedIn }) });
    } catch (error: unknown) {
      failRoute(res, error, authLog(), 'session', 'readSession');
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const id = await liveSessionId(req, db);
      if (id !== undefined) await deleteSession(db, id);
      setCookie(res, SESSION_COOKIE, '', { maxAge: 0, path: '/', secure: wantsSecureCookie(req) });
      res.json({ success: true, data: signInState.parse({ signedIn: false }) });
    } catch (error: unknown) {
      failRoute(res, error, authLog(), 'logout', 'endSession');
    }
  });

  if (config.mode === 'password') {
    router.post('/login', passwordLogin(db, config.passwordHash, options.throttle ?? new LoginThrottle(), authLog));
  }
  if (config.mode === 'oidc') oidcRoutes(router, db, options.oidcClient ?? new OidcClient(config), authLog);
  if (config.mode !== 'none') tokenRoutes(router, db, authLog);

  router.use((_req, res) => fail(res, 404, 'NotFoundError', 'no such auth route for this AUTH_MODE'));
  return router;
}
