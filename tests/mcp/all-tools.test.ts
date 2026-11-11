import type { Db } from '../../src/data/repositories/db.ts';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, test } from 'bun:test';

import { registerTools } from '../../src/mcp/register.ts';
import { ROUTES } from '../../src/routes/http.ts';
import { ALL_TOOLS } from '../../src/routes/tools.ts';
import { captureLog } from '../support/capture-log.ts';

/**
 * Imports `src/routes/tools.ts` and never `src/mcp/server.ts`: `createMCP` starts the server when called
 * and exits the process if setup throws, so nothing a test imports may reach it.
 */

/** Only the definitions are inspected; `Db` is handed through to `run` and never called here. */
const stubDb = {} as Db;

describe('ALL_TOOLS', () => {
  test('ALL_TOOLS has no duplicate name', () => {
    const names = ALL_TOOLS.map((tool) => tool.name);
    expect(names.length).toBe(new Set(names).size);
  });

  test('every tool has a non-empty title and description', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.title.trim().length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(0);
    }
  });

  test('registering every tool against one server raises nothing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    expect(() => registerTools(server, stubDb, ALL_TOOLS, captureLog().log)).not.toThrow();
  });

  test('every route that names a tool shares that tool\'s schema object', () => {
    for (const spec of ROUTES) {
      expect(spec.schemas).toHaveLength(spec.tools.length);
      for (const [index, name] of spec.tools.entries()) {
        const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
        expect({ route: spec.path, tool: name, found: tool !== undefined }).toEqual({ route: spec.path, tool: name, found: true });
        expect(spec.schemas[index]).toBe(tool?.input);
      }
    }
  });
});

describe('ALL_TOOLS without a notebook', () => {
  test('holds service_info and the companies and filings tools while OPEN_NOTEBOOK_URL is unset', () => {
    // `ALL_TOOLS` is built at import and never reads the environment: the notebook tools are
    // added by `server.ts` only when a notebook is configured, so unset means none of them.
    const saved = process.env.OPEN_NOTEBOOK_URL;
    delete process.env.OPEN_NOTEBOOK_URL;
    try {
      expect(ALL_TOOLS.map((tool) => tool.name)).toEqual(['service_info', 'company_list', 'company_update', 'filing_list', 'filing_summary']);
    } finally {
      if (saved !== undefined) process.env.OPEN_NOTEBOOK_URL = saved;
    }
  });
});
