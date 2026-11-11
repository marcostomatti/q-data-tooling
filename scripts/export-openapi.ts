/**
 * Writes the OpenAPI document the service serves at `GET /api/openapi.json` to a file, for tools
 * that read it offline: a client generator, a linter, a diff of the API between two commits.
 *
 * Usage: `bun scripts/export-openapi.ts [--out=<file>]` (default `.docs/openapi.json`).
 * It builds the document from `ROUTES` exactly as `mountRoutes` does, and opens no database.
 *
 * @module
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import packageJson from '../package.json' with { type: 'json' };
import { APP } from '../src/app-config.ts';
import { buildOpenApiDocument } from '../src/http/openapi.ts';
import { ROUTES } from '../src/routes/http.ts';

/** The checkout root. */
const PROJECT_ROOT = resolve(dirname(import.meta.path), '..');

/** Where the document goes when no `--out` is given; `.docs/` is gitignored. */
export const DEFAULT_OUT: string = resolve(PROJECT_ROOT, '.docs/openapi.json');

/**
 * Writes the document to `out`, making its folder when it is missing.
 *
 * @param out - The file to write.
 * @returns The path written.
 */
export async function exportOpenApi(out: string): Promise<string> {
  const document = buildOpenApiDocument(ROUTES, { title: APP.name, version: packageJson.version });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return out;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  console.log(await exportOpenApi(values.out === undefined
    ? DEFAULT_OUT
    : resolve(values.out)));
}
