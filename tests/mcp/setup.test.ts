import type { Db } from '../../src/data/repositories/db.ts';
import type { McpTransport } from '../../src/mcp/transport.ts';
import type { NotebookStartup } from '../../src/notebook/startup.ts';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const logs = defineTool({
  name: 'logs',
  title: 'Logs',
  description: 'Logs one line.',
  input: z.strictObject({}),
  run: async (_args, { log }) => {
    log.info({ step: 'probe' }, 'tool line');
    return 'ok';
  },
});

const NOTEBOOK: NotebookStartup = { tools: [], message: 'notebook tools off: made up for this test' };

/** Runs the setup on a bare server, returning what it logged. */
function runSetup(transport: McpTransport, notebook: NotebookStartup | undefined) {
  const captured = captureLog();
  setupMcp(new McpServer({ name: 'test', version: '0.0.0' }), {
    db: stubDb,
    tools: [ping],
    notebook,
    transport,
    log: captured.log,
  });
  return { records: captured.records };
}

describe('setupMcp', () => {
  test('over HTTP, logs the tool count and the notebook message as Mcp:start', () => {
    const { records } = runSetup('http', NOTEBOOK);

    expect(records).toEqual([
      { domain: 'Mcp', scope: 'start', step: 'register', tools: 1, level: 'info', msg: 'registered MCP tools' },
      { domain: 'Mcp', scope: 'start', step: 'addNotebook', notebookTools: 0, level: 'info', msg: NOTEBOOK.message },
    ]);
  });

  test('on stdio, logs the same Mcp:start lines on the log it is given, which writes to stderr there', () => {
    const { records } = runSetup('stdio', NOTEBOOK);

    expect(records).toEqual([
      { domain: 'Mcp', scope: 'start', step: 'register', tools: 1, level: 'info', msg: 'registered MCP tools' },
      { domain: 'Mcp', scope: 'start', step: 'addNotebook', notebookTools: 0, level: 'info', msg: NOTEBOOK.message },
    ]);
  });

  test.each(['stdio', 'http'] as const)('on %s, a tool call logs on the log it is given, under the call\'s own traceId', async (transport) => {
    const captured = captureLog();
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    setupMcp(server, { db: stubDb, tools: [logs], notebook: undefined, transport, log: captured.log });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    await client.callTool({ name: 'logs', arguments: {} });

    const line = captured.records.find((record) => record.msg === 'tool line');
    expect(line).toMatchObject({ step: 'probe', level: 'info', traceId: expect.stringMatching(UUID) });
  });

  test('with no notebook probe, logs the count alone', () => {
    const { records } = runSetup('http', undefined);

    expect(records.map((record) => record.step)).toEqual(['register']);
  });
});
