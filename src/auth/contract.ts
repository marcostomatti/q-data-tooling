import { z } from 'zod';

// The `/auth` routes' inputs and answers. The web bundle imports this module, so it imports
// nothing but `zod`: no store, no database, no Node built-in.

/** The longest name a token may be listed under, after trimming. */
export const TOKEN_NAME_MAX = 80;

/** The highest token id the id param takes: the top of a signed 32-bit integer column. */
export const TOKEN_ID_MAX = 2_147_483_647;

/** The longest password the sign-in reads, so a huge body is not hashed. */
export const PASSWORD_MAX = 1024;

const TOKEN_NAME_RULE = `a token needs a name of 1 to ${TOKEN_NAME_MAX} characters`;

/**
 * The body of `POST /auth/login`: the password, 1 to {@link PASSWORD_MAX} characters. Strict, so
 * a stray field is refused rather than silently dropped.
 */
export const loginInput = z.strictObject({
  password: z.string().min(1)
    .max(PASSWORD_MAX),
});

export type LoginInput = z.infer<typeof loginInput>;

/**
 * The body of `POST /auth/tokens`: the name the token is listed under, trimmed, 1 to
 * {@link TOKEN_NAME_MAX} characters. Every refusal of the name carries the same message, the one
 * `tokenName` in `src/auth/store.ts` throws, so the store and the schema read as one rule.
 */
export const createTokenInput = z.strictObject({
  name: z
    .string({ error: TOKEN_NAME_RULE })
    .trim()
    .min(1, { error: TOKEN_NAME_RULE })
    .max(TOKEN_NAME_MAX, { error: TOKEN_NAME_RULE }),
});

export type CreateTokenInput = z.infer<typeof createTokenInput>;

/**
 * The params of `DELETE /auth/tokens/:id`: the id, read from its path segment as a positive whole
 * number of at most {@link TOKEN_ID_MAX}.
 */
export const tokenIdParam = z.strictObject({
  id: z.coerce.number().int()
    .positive()
    .max(TOKEN_ID_MAX),
});

export type TokenIdParam = z.infer<typeof tokenIdParam>;

/** What `GET /auth/session` answers: the login mode that is on, and whether this browser is signed in. */
export const sessionState = z.strictObject({
  mode: z.enum(['none', 'password', 'oidc']),
  signedIn: z.boolean(),
});

export type SessionState = z.infer<typeof sessionState>;

/** The login mode, one of `none`, `password` and `oidc`. */
export type AuthMode = SessionState['mode'];

/** What sign-in and sign-out answer: whether this browser is now signed in. */
export const signInState = z.strictObject({
  signedIn: z.boolean(),
});

export type SignInState = z.infer<typeof signInState>;

/**
 * What the token list shows of one token: its id, name and leading characters, and when it was
 * made, last used and revoked, each an ISO 8601 time or `null`. The token itself is never stored,
 * so it is never listed.
 */
export const tokenSummary = z.strictObject({
  id: z.number().int()
    .positive()
    .max(TOKEN_ID_MAX),
  name: z.string(),
  prefix: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});

export type TokenSummary = z.infer<typeof tokenSummary>;

/** What `POST /auth/tokens` answers: the new token, shown this once, with its summary. */
export const createdToken = z.strictObject({
  token: z.string().min(1),
  summary: tokenSummary,
});

export type CreatedToken = z.infer<typeof createdToken>;
