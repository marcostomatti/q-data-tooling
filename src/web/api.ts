import type {
  CreatedToken,
  CreateTokenInput,
  LoginInput,
  SessionState,
  SignInState,
  TokenSummary,
} from '../auth/contract.ts';
import type { CompanyListOutput, CompanyUpdateInput, CompanyUpdateOutput } from '../routes/companies/contract.ts';

export type { AuthMode, CreatedToken, SessionState, SignInState, TokenSummary } from '../auth/contract.ts';

/** The header every write sends. It must match the server's `CSRF_HEADER` in `src/auth/cookies.ts`, which is `x-app-csrf`. */
const CSRF_HEADERS = { 'x-app-csrf': '1' } as const;

/** A refusal or failure from the server, carrying its envelope's name and message. */
export class ApiError extends Error {
  readonly status: number;
  readonly errorName: string;

  constructor(status: number, errorName: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorName = errorName;
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

/**
 * What the Companies page asks `GET /api/companies` for: the page from 1, its size, the search
 * text, and whether to keep only the companies in the summary.
 */
export interface CompanyQuery {
  /** The page to fetch, from 1. */
  readonly page: number
  /** The most companies one page holds. */
  readonly pageSize: number
  /** A ticker prefix or part of a name; blank sends no `q`. */
  readonly q: string
  /** Keeps only the companies in the summary when set; unset sends no `selected`. */
  readonly selectedOnly: boolean
}

/** One page of companies, the `z.infer` type of `CompanyListOutput` in `src/routes/companies/contract.ts`. */
export type CompanyPage = CompanyListOutput;

/** One company as the server answers it, the `z.infer` type of `CompanyUpdateOutput`. */
export type Company = CompanyUpdateOutput;

/**
 * Builds the `GET /api/companies` path for a query. A blank `q` is left out, because the route
 * refuses an empty one, and `selected` is sent only as `true`: the page filters to the selected
 * companies or not at all.
 *
 * @param query - The page, size, search text and selected-only flag to ask for.
 * @returns The path with its query string, such as `/api/companies?page=1&pageSize=25`.
 */
export function companiesPath(query: CompanyQuery): string {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  const q = query.q.trim();
  if (q.length > 0) params.set('q', q);
  if (query.selectedOnly) params.set('selected', 'true');
  return `/api/companies?${params.toString()}`;
}

/**
 * The `PATCH` path of one company, its ticker encoded so a `/` or `?` in it stays in the segment.
 *
 * @param ticker - The company's ticker, such as `AAPL`.
 * @returns The path, such as `/api/companies/AAPL`.
 */
export function companyPath(ticker: string): string {
  return `/api/companies/${encodeURIComponent(ticker)}`;
}

/**
 * The `/api/companies` calls, each going through `fetchImpl`, so a test can hand in a stand-in.
 * The answer types are imported as types only, so the bundle does not carry zod for them.
 *
 * @param fetchImpl - The `fetch` every call goes through.
 * @returns The client, whose `list` resolves to one page of companies and whose `select` sends
 *   `PATCH /api/companies/:ticker` with the explicit `selected` boolean, never a toggle, and
 *   resolves to the company as it stands after; either throws an `ApiError` on a refusal.
 */
export function createCompaniesClient(fetchImpl: typeof fetch) {
  return {
    list: (query: CompanyQuery): Promise<CompanyPage> => request('GET', companiesPath(query), undefined, fetchImpl),
    select: (ticker: string, selected: CompanyUpdateInput['selected']): Promise<Company> => {
      const body = { selected } satisfies Pick<CompanyUpdateInput, 'selected'>;
      return request('PATCH', companyPath(ticker), body, fetchImpl);
    },
  };
}

/** The `/api/companies` calls over the browser's own `fetch`. */
export const companies = createCompaniesClient(fetch);
