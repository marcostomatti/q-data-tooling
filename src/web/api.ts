import type {
  CreatedToken,
  CreateTokenInput,
  LoginInput,
  SessionState,
  SignInState,
  TokenSummary,
} from '../auth/contract.ts';

export type { AuthMode, CreatedToken, SessionState, SignInState, TokenSummary } from '../auth/contract.ts';

/** The header every write sends. It must match the server's `CSRF_HEADER` in `src/auth/cookies.ts`, which is `x-app-csrf`. */
const CSRF_HEADERS = { 'x-app-csrf': '1' } as const;

/** A refusal or failure from the server, carrying its envelope's name and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope<T> = { success: true; data: T } | { success: false; error: { name: string; message: string } | string };

/** Calls a same-origin JSON route and returns its `data`, or throws an `ApiError` with the envelope's message. */
export async function request<T>(method: string, path: string, body?: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const response = await fetchImpl(path, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(method === 'GET'
        ? {}
        : CSRF_HEADERS),
      ...(body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });
  let envelope: Envelope<T> | undefined;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    envelope = undefined;
  }
  if (envelope?.success === true) return envelope.data;
  const error = envelope?.success === false
    ? envelope.error
    : undefined;
  if (typeof error === 'object') throw new ApiError(response.status, error.name, error.message);
  throw new ApiError(response.status, 'Error', typeof error === 'string'
    ? error
    : `the server answered ${response.status}`);
}

/**
 * The `/auth` routes' calls, each going through `fetchImpl`, so a test can hand in a stand-in.
 * Their answer types are the `z.infer` types of `src/auth/contract.ts`, imported as types only so
 * the bundle does not carry zod for them.
 */
export function createAuthClient(fetchImpl: typeof fetch) {
  return {
    session: (): Promise<SessionState> => request('GET', '/auth/session', undefined, fetchImpl),
    login: (password: LoginInput['password']): Promise<SignInState> => request('POST', '/auth/login', { password } satisfies LoginInput, fetchImpl),
    logout: (): Promise<SignInState> => request('POST', '/auth/logout', undefined, fetchImpl),
    listTokens: (): Promise<TokenSummary[]> => request('GET', '/auth/tokens', undefined, fetchImpl),
    createToken: (name: CreateTokenInput['name']): Promise<CreatedToken> => request('POST', '/auth/tokens', { name } satisfies CreateTokenInput, fetchImpl),
    revokeToken: (id: TokenSummary['id']): Promise<TokenSummary> => request('DELETE', `/auth/tokens/${id}`, undefined, fetchImpl),
  };
}

/** The `/auth` calls over the browser's own `fetch`. */
export const auth = createAuthClient(fetch);
