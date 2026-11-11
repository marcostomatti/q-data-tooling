import type { AuthMode } from './contract.ts';
import type { DocumentedOperation, DocumentedResponse } from '../http/openapi.ts';

import { z } from 'zod';

import { failureResponse, SECURITY, successResponse } from '../http/openapi.ts';

import { createdToken, createTokenInput, loginInput, sessionState, signInState, tokenIdParam, tokenSummary } from './contract.ts';
import { CSRF_HEADER } from './cookies.ts';

// The `/auth` routes of `authRouter` in `routes.ts`, as document operations. Each reads its
// schemas from `contract.ts`, the module the routes parse with, so the two cannot drift apart.

const TAG = 'auth';

/** The header every unsafe `/auth` request sends, so another site cannot sign this browser in or out. */
const csrfHeader = z.strictObject({ [CSRF_HEADER]: z.literal('1') });

/** The token routes' credential: a signed-in browser only, never an API key or a token. */
const SESSION_ONLY = [{ [SECURITY.session]: [] }];

const forbidden = failureResponse(`The \`${CSRF_HEADER}: 1\` header is missing.`);
const failed = failureResponse('The work failed inside the service; the message says nothing more.');
const signInFirst = failureResponse('This browser is not signed in.');

/** A redirect, which carries no body: the browser follows `Location`. */
const redirect = (description: string): DocumentedResponse => ({ description });

/** `GET /auth/session` and `POST /auth/logout`, which every mode serves. */
const SESSION_OPERATIONS: readonly DocumentedOperation[] = [
  {
    method: 'get',
    path: '/auth/session',
    summary: 'The sign-in mode that is on, and whether this browser is signed in. Needs no credential.',
    tags: [TAG],
    security: [],
    responses: { 200: successResponse('The mode and the sign-in state.', sessionState), 500: failed },
  },
  {
    method: 'post',
    path: '/auth/logout',
    summary: 'Signs this browser out: ends its session and clears the cookie.',
    tags: [TAG],
    security: [],
    request: { headers: csrfHeader },
    responses: { 200: successResponse('Signed out; `signedIn` is false.', signInState), 403: forbidden, 500: failed },
  },
];

/** `POST /auth/login`, served when `AUTH_MODE=password`. */
const PASSWORD_OPERATIONS: readonly DocumentedOperation[] = [
  {
    method: 'post',
    path: '/auth/login',
    summary: 'Signs this browser in with the password, and sets the session cookie. Only when AUTH_MODE=password.',
    tags: [TAG],
    security: [],
    request: { headers: csrfHeader, body: { required: true, content: { 'application/json': { schema: loginInput } } } },
    responses: {
      200: successResponse('Signed in; the answer sets the session cookie.', signInState),
      400: failureResponse('The body is not `{ password }`.'),
      401: failureResponse('The password is wrong.'),
      403: forbidden,
      429: failureResponse('Too many wrong passwords; `Retry-After` gives the seconds to wait.'),
      500: failed,
    },
  },
];

/** The two OIDC steps, served when `AUTH_MODE=oidc`. Both answer a redirect for the browser to follow. */
const OIDC_OPERATIONS: readonly DocumentedOperation[] = [
  {
    method: 'get',
    path: '/auth/oidc/start',
    summary: 'Starts an OIDC sign-in: redirects the browser to the provider. Only when AUTH_MODE=oidc.',
    tags: [TAG],
    security: [],
    responses: { 302: redirect('To the provider, or to `/login?error=oidc` when the attempt cannot start.') },
  },
  {
    method: 'get',
    path: '/auth/oidc/callback',
    summary: 'Where the provider sends the browser back; sets the session cookie. Only when AUTH_MODE=oidc.',
    tags: [TAG],
    security: [],
    request: { query: z.strictObject({ code: z.string(), state: z.string() }) },
    responses: { 302: redirect('To `/` when signed in, or to `/login?error=oidc` when the sign-in is refused.') },
  },
];

/** The API token routes, served in any mode with a sign-in. Each needs a signed-in browser. */
const TOKEN_OPERATIONS: readonly DocumentedOperation[] = [
  {
    method: 'get',
    path: '/auth/tokens',
    summary: 'Lists the API tokens. The tokens themselves are never stored, so never listed.',
    tags: [TAG],
    security: SESSION_ONLY,
    responses: { 200: successResponse('Every token, revoked ones included.', tokenSummary.array()), 401: signInFirst, 500: failed },
  },
  {
    method: 'post',
    path: '/auth/tokens',
    summary: 'Makes an API token for `Authorization: Bearer`. The answer shows the token this once.',
    tags: [TAG],
    security: SESSION_ONLY,
    request: { headers: csrfHeader, body: { required: true, content: { 'application/json': { schema: createTokenInput } } } },
    responses: {
      201: successResponse('The new token and its summary.', createdToken),
      400: failureResponse('The name is missing, empty or too long.'),
      401: signInFirst,
      403: forbidden,
      500: failed,
    },
  },
  {
    method: 'delete',
    path: '/auth/tokens/{id}',
    summary: 'Revokes one API token. Revoking a revoked token answers it unchanged.',
    tags: [TAG],
    security: SESSION_ONLY,
    request: { headers: csrfHeader, params: tokenIdParam },
    responses: {
      200: successResponse('The token, now revoked.', tokenSummary),
      400: failureResponse('The id is not a positive whole number.'),
      401: signInFirst,
      403: forbidden,
      404: failureResponse('No token has this id.'),
      500: failed,
    },
  },
];

/**
 * The `/auth` operations `authRouter` serves in `mode`, so the document lists the routes that
 * answer and none that would answer 404: the session and sign-out in every mode, the password or
 * OIDC sign-in for its mode, and the token routes whenever a sign-in is on.
 *
 * @param mode - The sign-in mode, `AUTH_MODE`.
 * @returns The operations, with their full paths.
 */
export function authOperations(mode: AuthMode): readonly DocumentedOperation[] {
  const signIn = {
    none: [],
    password: PASSWORD_OPERATIONS,
    oidc: OIDC_OPERATIONS,
  }[mode];
  return [
    ...SESSION_OPERATIONS,
    ...signIn,
    ...(mode === 'none'
      ? []
      : TOKEN_OPERATIONS),
  ];
}
