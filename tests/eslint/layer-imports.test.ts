import { join } from 'node:path';

import { describe, expect, it, test } from 'bun:test';
import { RuleTester } from 'eslint';
import { parser } from 'typescript-eslint';

import layerImports, { layerOf, roleOf } from '../../eslint/rules/layer-imports.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const REPO_ROOT = join(import.meta.dir, '..', '..');

/** The absolute path ESLint would hand the rule for a repo-relative file. */
const at = (path: string): string => join(REPO_ROOT, path);

const FLOW = 'src/routes/info/get.flow.ts';
const ROUTE_HTTP = 'src/routes/info/http.ts';
const TOOL = 'src/routes/info/tool.ts';

/** What the flow entry admits from `src/logging.ts`, as its message lists it. */
const FLOW_LOGGING = 'scoped and import type { Log }';

/** The report the rule makes for one name a flow takes from `src/logging.ts`. */
const forbiddenName = (name: string) => ({
  messageId: 'forbiddenName',
  data: { entry: 'flow', specifier: '../../logging.ts', admitted: FLOW_LOGGING, name },
});

/** The report the rule makes for one import, as the message reads it. */
const forbidden = (entry: string, specifier: string, layer: string) => ({
  messageId: 'forbidden',
  data: { entry, specifier, layer },
});

describe('roleOf', () => {
  test('takes the last dot segment before the extension', () => {
    expect(roleOf('src/routes/info/get.flow.ts')).toBe('flow');
    expect(roleOf('src/routes/info/http.ts')).toBe('http');
    expect(roleOf('src/web/app.tsx')).toBe('app');
  });
});

describe('layerOf', () => {
  test('names the alias, drizzle, a layer directory, a role, a directory and a package', () => {
    expect(layerOf('#db', false)).toBe('the #db alias');
    expect(layerOf('drizzle-orm/sqlite-core', false)).toBe('drizzle-orm');
    expect(layerOf('src/data/active.ts', true)).toBe('in src/data');
    expect(layerOf('src/routes/info/tool.ts', true)).toBe('a tool.ts');
    expect(layerOf('src/routes/info/http.ts', true)).toBe('an http.ts');
    expect(layerOf('src/errors.ts', true)).toBe('in src');
    expect(layerOf('node:fs', false)).toBe('the package node:fs');
  });
});

const ruleTester = new RuleTester({
  languageOptions: { parser },
});

ruleTester.run('template/layer-imports', layerImports, {
  valid: [
    {
      name: 'the planted-import control\'s clean flow imports only its contract',
      filename: at(FLOW),
      code: 'import type { Input } from \'./contract.ts\';',
    },
    {
      name: 'a flow imports shared code and packages',
      filename: at(FLOW),
      code: [
        'import { APP } from \'../../app-config.ts\';',
        'import { z } from \'zod\';',
      ].join('\n'),
    },
    {
      name: 'a flow re-exports its contract and exports without a source',
      filename: at(FLOW),
      code: [
        'export * from \'./contract.ts\';',
        'export type { Input } from \'./contract.ts\';',
        'const local = 1;',
        'export { local };',
      ].join('\n'),
    },
    {
      name: 'a flow takes scoped and import type { Log } from src/logging.ts',
      filename: at(FLOW),
      code: [
        'import type { Log } from \'../../logging.ts\';',
        'import { scoped } from \'../../logging.ts\';',
      ].join('\n'),
    },
    {
      name: 'a flow takes scoped and an inline type Log in one import',
      filename: at(FLOW),
      code: 'import { scoped, type Log } from \'../../logging.ts\';',
    },
    {
      name: 'a route http.ts takes lazyLogger and inDomain from src/logging.ts',
      filename: at(ROUTE_HTTP),
      code: 'import { inDomain, lazyLogger } from \'../../logging.ts\';',
    },
    {
      name: 'the clean fixture\'s route http.ts imports the data layer, src/http and its flow',
      filename: at(ROUTE_HTTP),
      code: [
        'import { DIALECT } from \'../../data/active.ts\';',
        'import { route } from \'../../http/route.ts\';',
        'import { getServiceInfo } from \'./get.flow.ts\';',
      ].join('\n'),
    },
    {
      name: 'a tool.ts imports src/mcp and a flow',
      filename: at(TOOL),
      code: [
        'import { defineTool } from \'../../mcp/register.ts\';',
        'import { getServiceInfo } from \'./get.flow.ts\';',
      ].join('\n'),
    },
    {
      name: 'src/http and src/mcp import themselves',
      filename: at('src/http/a.ts'),
      code: 'import { b } from \'./b.ts\';',
    },
    {
      name: 'src/mcp imports itself',
      filename: at('src/mcp/a.ts'),
      code: 'import { b } from \'./b.ts\';',
    },
    {
      name: 'an entity imports zod and other entities',
      filename: at('src/entities/thing.ts'),
      code: [
        'import { z } from \'zod\';',
        'import { other } from \'./other.ts\';',
      ].join('\n'),
    },
    {
      name: 'a file no entry covers imports anything',
      filename: at('src/routes/info/contract.ts'),
      code: [
        'import { db } from \'#db\';',
        'import { eq } from \'drizzle-orm\';',
        'import { route } from \'../../http/route.ts\';',
      ].join('\n'),
    },
  ],
  invalid: [
    {
      name: 'flow: the layout test\'s planted import of the data layer',
      filename: at(FLOW),
      code: [
        'import type { Input } from \'./contract.ts\';',
        'import { DIALECT } from \'../../data/active.ts\';',
      ].join('\n'),
      errors: [{ ...forbidden('flow', '../../data/active.ts', 'in src/data'), line: 2, type: 'ImportDeclaration' }],
    },
    {
      name: 'flow: #db is kept as is and forbidden',
      filename: at(FLOW),
      code: 'import { db } from \'#db\';',
      errors: [{ ...forbidden('flow', '#db', 'the #db alias'), type: 'ImportDeclaration' }],
    },
    {
      name: 'flow: a named re-export of drizzle-orm',
      filename: at(FLOW),
      code: 'export { eq } from \'drizzle-orm\';',
      errors: [{ ...forbidden('flow', 'drizzle-orm', 'drizzle-orm'), type: 'ExportNamedDeclaration' }],
    },
    {
      name: 'flow: a star re-export of a repository',
      filename: at(FLOW),
      code: 'export * from \'./info.repository.ts\';',
      errors: [{ ...forbidden('flow', './info.repository.ts', 'a repository.ts'), type: 'ExportAllDeclaration' }],
    },
    {
      name: 'flow: lazyLogger from src/logging.ts',
      filename: at(FLOW),
      code: 'import { lazyLogger } from \'../../logging.ts\';',
      errors: [{ ...forbiddenName('lazyLogger'), type: 'ImportSpecifier' }],
    },
    {
      name: 'flow: inDomain beside an admitted scoped is reported alone',
      filename: at(FLOW),
      code: 'import { inDomain, scoped } from \'../../logging.ts\';',
      errors: [{ ...forbiddenName('inDomain'), column: 10 }],
    },
    {
      name: 'flow: Log as a value import, a namespace and a star re-export',
      filename: at(FLOW),
      code: [
        'import { Log } from \'../../logging.ts\';',
        'import * as logging from \'../../logging.ts\';',
        'export * from \'../../logging.ts\';',
      ].join('\n'),
      errors: [
        { ...forbiddenName('Log'), line: 1 },
        { ...forbiddenName('*'), line: 2, type: 'ImportNamespaceSpecifier' },
        { ...forbiddenName('*'), line: 3, type: 'ExportAllDeclaration' },
      ],
    },
    {
      name: 'flow: a re-export of lazyLogger under another name',
      filename: at(FLOW),
      code: 'export { lazyLogger as logger } from \'../../logging.ts\';',
      errors: [{ ...forbiddenName('lazyLogger'), type: 'ExportSpecifier' }],
    },
    {
      name: 'route http.ts: a tool.ts',
      filename: at(ROUTE_HTTP),
      code: 'import { infoTool } from \'./tool.ts\';',
      errors: [forbidden('route http.ts', './tool.ts', 'a tool.ts')],
    },
    {
      name: 'tool.ts: src/http',
      filename: at(TOOL),
      code: 'import { route } from \'../../http/route.ts\';',
      errors: [forbidden('tool.ts', '../../http/route.ts', 'in src/http')],
    },
    {
      name: 'src/http: src/mcp',
      filename: at('src/http/a.ts'),
      code: 'import { server } from \'../mcp/server.ts\';',
      errors: [forbidden('src/http', '../mcp/server.ts', 'in src/mcp')],
    },
    {
      name: 'src/mcp: src/http',
      filename: at('src/mcp/a.ts'),
      code: 'import { server } from \'../http/server.ts\';',
      errors: [forbidden('src/mcp', '../http/server.ts', 'in src/http')],
    },
    {
      name: 'entity: a package other than zod, and code outside src/entities',
      filename: at('src/entities/thing.ts'),
      code: [
        'import { readFile } from \'node:fs\';',
        'import { AppError } from \'../errors.ts\';',
      ].join('\n'),
      errors: [
        { ...forbidden('entity', 'node:fs', 'the package node:fs'), line: 1 },
        { ...forbidden('entity', '../errors.ts', 'in src'), line: 2 },
      ],
    },
    {
      name: 'a file two entries cover is reported once, under the first',
      filename: at('src/http/get.flow.ts'),
      code: 'import { server } from \'../mcp/server.ts\';',
      errors: [forbidden('flow', '../mcp/server.ts', 'in src/mcp')],
    },
  ],
});
