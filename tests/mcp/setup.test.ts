import type { Db } from '../../src/data/repositories/db.ts';
import type { McpTransport } from '../../src/mcp/transport.ts';
import type { NotebookStartup } from '../../src/notebook/startup.ts';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { defineTool } from '../../src/mcp/register.ts';
import { setupMcp } from '../../src/mcp/setup.ts';
import { captureLog } from '../support/capture-log.ts';

/** `Db` is only handed through to `run`, so a stub that is never called stands in for it. */
const stubDb = {} as Db;

const ping = defineTool({
  name: 'ping',
  title: 'Ping',
  description: 'Answers.',
  input: z.strictObject({}),
  run: async () => ({ ok: true }),
});

const NOTEBOOK: NotebookStartup = { tools: [], message: 'notebook tools off: made up for this test' };

/** Runs the setup on a bare server, returning what it logged and what it wrote to stderr. */
function runSetup(transport: McpTransport, notebook: NotebookStartup | undefined) {
  const captured = captureLog();
  const written: string[] = [];
  setupMcp(new McpServer({ name: 'test', version: '0.0.0' }), {
    db: stubDb,
    tools: [ping],
    notebook,
    transport,
    log: captured.log,
    writeStderr: (text) => void written.push(text),
  });
  return { records: captured.records, written };
}

describe('setupMcp', () => {
  test('over HTTP, logs the tool count and the notebook message as Mcp:start', () => {
    const { records, written } = runSetup('http', NOTEBOOK);

    expect(records).toEqual([
      { domain: 'Mcp', scope: 'start', step: 'register', tools: 1, level: 'info', msg: 'registered MCP tools' },
      { domain: 'Mcp', scope: 'start', step: 'addNotebook', notebookTools: 0, level: 'info', msg: NOTEBOOK.message },
    ]);
    expect(written).toEqual([]);
  });

  test('on stdio, logs nothing and writes the count and the message to stderr', () => {
    const { records, written } = runSetup('stdio', NOTEBOOK);

    // The control for the test above: the same setup, on the same fake, writes no record here
    expect(records).toEqual([]);
    expect(written).toEqual(['registered 1 MCP tools\n', `${NOTEBOOK.message}\n`]);
  });

  test('with no notebook probe, logs the count alone', () => {
    const { records } = runSetup('http', undefined);

    expect(records.map((record) => record.step)).toEqual(['register']);
  });
});
