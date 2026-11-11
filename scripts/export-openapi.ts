/**
 * Writes the OpenAPI document the service serves at `GET /api/openapi.json` to a file, for tools
 * that read it offline: a client generator, a linter, a diff of the API between two commits.
 *
 * Usage: `bun scripts/export-openapi.ts [--out=<file>] [--auth-mode=<none|password|oidc>]`. The
 * file defaults to `.docs/openapi.json`, and the mode to `AUTH_MODE`, else `none`. It builds the
 * document exactly as `mountRoutes` does, and opens no database.
 *
 * @module
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { sessionState, type AuthMode } from '../src/auth/contract.ts';
import { serviceDocument } from '../src/routes/http.ts';

/** The checkout root. */
const PROJECT_ROOT = resolve(dirname(import.meta.path), '..');

/** Where the document goes when no `--out` is given; `.docs/` is gitignored. */
export const DEFAULT_OUT: string = resolve(PROJECT_ROOT, '.docs/openapi.json');

/** The sign-in modes the document can list the `/auth` routes of. */
const AuthModeSchema = sessionState.shape.mode;

/**
 * Reads the sign-in mode from a flag or `AUTH_MODE`, defaulting to `none`.
 *
 * @param value - The flag's or the variable's value, or `undefined` when neither is set.
 * @returns The mode.
 * @throws {Error} If the value is not `none`, `password` or `oidc`.
 */
export function authModeOf(value: string | undefined): AuthMode {
  const parsed = AuthModeSchema.safeParse(value === undefined || value === ''
    ? 'none'
    : value);
  if (!parsed.success) throw new Error(`the sign-in mode must be none, password or oidc, not ${value}`);
  return parsed.data;
}

/**
 * Writes the document to `out`, making its folder when it is missing.
 *
 * @param out - The file to write.
 * @param mode - The sign-in mode whose `/auth` routes the document lists.
 * @returns The path written.
 */
export async function exportOpenApi(out: string, mode: AuthMode = 'none'): Promise<string> {
  const document = serviceDocument(mode);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return out;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { 'out': { type: 'string' }, 'auth-mode': { type: 'string' } } });
  console.log(await exportOpenApi(values.out === undefined
    ? DEFAULT_OUT
    : resolve(values.out), authModeOf(values['auth-mode'] ?? process.env.AUTH_MODE)));
}
