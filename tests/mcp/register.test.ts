import type { Db } from '../../src/data/repositories/db.ts';
import type { Log } from '../../src/logging.ts';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, spyOn, test } from 'bun:test';
import { z } from 'zod';

import { ConflictError, NotFoundError } from '../../src/errors.ts';
import { defineTool, registerTools, type ToolDefinition } from '../../src/mcp/register.ts';
import { IdSchema } from '../../src/routes/common.ts';
import { captureLog } from '../support/capture-log.ts';

/** `Db` is only handed through to `run`, so a stub that is never called stands in for it. */
const stubDb = {} as Db;

type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

/** Registers the definitions on a bare server and connects a client to it in memory. */
async function connect(definitions: readonly ToolDefinition[], db: Db = stubDb, log: Log = captureLog().log): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server, db, definitions, log);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallResult> {
  return (await client.callTool({ name, arguments: args })) as CallResult;
}

const echo = defineTool({
  name: 'echo',
  title: 'Echo',
  description: 'Returns what it was given.',
  input: z.strictObject({ id: IdSchema, label: z.string().default('none') }),
  run: async (args) => args,
});

describe('registerTools', () => {
  test('registerTools registers one tool per definition under its own name', async () => {
    const other = defineTool({
      name: 'other',
      title: 'Other',
      description: 'Does nothing.',
      input: z.strictObject({}),
      run: async () => null,
    });
    const client = await connect([echo, other]);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(['echo', 'other']);
    expect(tools.find((tool) => tool.name === 'echo')).toMatchObject({
      title: 'Echo',
      description: 'Returns what it was given.',
    });
  });

  test('the whole Zod object is the tool input schema, listed as a closed object of its fields', async () => {
    const client = await connect([echo]);

    const { tools } = await client.listTools();

    expect(tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: { id: expect.anything(), label: expect.anything() },
    });
  });

  test('a handler receives arguments already parsed by its schema', async () => {
    const client = await connect([echo]);

    const result = await call(client, 'echo', { id: '7' });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ id: 7, label: 'none' });
  });

  test('the handler is given one context holding the db and a child of the log registerTools received', async () => {
    const seen: Array<{ readonly db: Db; readonly log: Log }> = [];
    const probe = defineTool({
      name: 'probe',
      title: 'Probe',
      description: 'Records its context.',
      input: z.strictObject({}),
      run: async (_args, context) => {
        seen.push(context);
        return 'ok';
      },
    });
    const { log, records } = captureLog();
    const client = await connect([probe], stubDb, log);

    await call(client, 'probe', {});
    seen[0]?.log.debug({ step: 'probe' }, 'probe line');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.db).toBe(stubDb);
    // The child writes into the base log's records, so it was made from that log.
    expect(records).toHaveLength(1);
    expect(records[0]?.msg).toBe('probe line');
  });

  test('two calls of one tool log two different traceIds on the lines their run wrote', async () => {
    const crumb = defineTool({
      name: 'crumb',
      title: 'Crumb',
      description: 'Logs two lines.',
      input: z.strictObject({ n: z.number() }),
      run: async ({ n }, { log }) => {
        log.debug({ step: 'first', n }, 'first line');
        log.debug({ step: 'second', n }, 'second line');
        return 'ok';
      },
    });
    const { log, records } = captureLog();
    const client = await connect([crumb], stubDb, log);

    await call(client, 'crumb', { n: 1 });
    await call(client, 'crumb', { n: 2 });

    const idsOf = (n: number): unknown[] => records
      .filter((record) => record.n === n)
      .map((record) => record.traceId);
    const first = idsOf(1);
    const second = idsOf(2);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(typeof first[0]).toBe('string');
    expect(first[0]).toMatch(/^[0-9a-f-]{36}$/);
    // One id per call: both lines of a call share it, and the two calls differ.
    expect(first[1]).toBe(first[0]);
    expect(second[1]).toBe(second[0]);
    expect(second[0]).not.toBe(first[0]);
  });

  test('without a log, a tool line goes to stderr and never to stdout, which stdio MCP owns', async () => {
    const loud = defineTool({
      name: 'loud',
      title: 'Loud',
      description: 'Logs one error line.',
      input: z.strictObject({}),
      run: async (_args, { log }) => {
        log.error({ step: 'probe' }, 'loud tool line');
        return 'ok';
      },
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTools(server, stubDb, [loud]);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);

    const written = (calls: unknown[][]): string => calls.map((args) => String(args[0])).join('');
    let onStdout: string;
    let onStderr: string;
    try {
      await call(client, 'loud', {});
      // Read before restoring: mockRestore clears the recorded calls.
      onStdout = written(stdout.mock.calls);
      onStderr = written(stderr.mock.calls);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    expect(onStdout).not.toContain('loud tool line');
    // The control: the line was written, so its absence from stdout is not a line never made.
    expect(onStderr).toContain('loud tool line');
  });

  test('a handler that throws returns an isError result rather than rejecting', async () => {
    const failing = defineTool({
      name: 'failing',
      title: 'Failing',
      description: 'Always conflicts.',
      input: z.strictObject({}),
      run: async () => {
        throw new ConflictError('item_key', 'acme-dev', { cause: new Error('insert into "items"') });
      },
    });
    const client = await connect([failing]);

    const result = await call(client, 'failing', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ConflictError');
    expect(JSON.stringify(result)).not.toContain('insert into');
  });

  test('a handler that throws an unknown error returns a flat internal error', async () => {
    const leaky = defineTool({
      name: 'leaky',
      title: 'Leaky',
      description: 'Throws a connection fault.',
      input: z.strictObject({}),
      run: async () => {
        throw new Error('connect ECONNREFUSED on port 5439');
      },
    });
    const client = await connect([leaky]);

    const result = await call(client, 'leaky', {});

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('5439');
    expect(result.content[0]?.text).toContain('internal error');
  });

  test('a non-async run that throws synchronously returns an isError result rather than rejecting', async () => {
    const sync = defineTool({
      name: 'sync-throw',
      title: 'Sync throw',
      description: 'Throws before returning a promise.',
      input: z.strictObject({}),
      run: () => {
        throw new NotFoundError('item', 7);
      },
    });
    const client = await connect([sync]);

    const result = await call(client, 'sync-throw', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('NotFoundError');
  });

  test('annotations are passed to the SDK when a definition has them and absent otherwise', async () => {
    const annotated = defineTool({
      name: 'annotated',
      title: 'Annotated',
      description: 'Carries a read-only hint.',
      input: z.strictObject({}),
      annotations: { readOnlyHint: true },
      run: async () => null,
    });
    const client = await connect([annotated, echo]);

    const { tools } = await client.listTools();

    expect(tools.find((tool) => tool.name === 'annotated')?.annotations).toEqual({ readOnlyHint: true });
    expect(tools.find((tool) => tool.name === 'echo')?.annotations).toBeUndefined();
  });

  test('a tool that returns a value JSON cannot hold returns an internal error rather than crashing', async () => {
    const odd = defineTool({
      name: 'odd',
      title: 'Odd',
      description: 'Returns a BigInt.',
      input: z.strictObject({}),
      run: async () => ({ n: 1n }),
    });
    const client = await connect([odd]);

    const result = await call(client, 'odd', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('internal error');
  });

  test('input the schema refuses never reaches run', async () => {
    let ran = false;
    const guarded = defineTool({
      name: 'guarded',
      title: 'Guarded',
      description: 'Records that it ran.',
      input: z.strictObject({ id: IdSchema }),
      run: async () => {
        ran = true;
        return null;
      },
    });
    const client = await connect([guarded]);

    const result = await call(client, 'guarded', { id: 'abc' });

    expect(ran).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Input validation error');
  });

  test('registering two definitions under one name throws, so a duplicate cannot ship', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });

    expect(() => registerTools(server, stubDb, [echo, echo], captureLog().log)).toThrow(/already registered/);
  });
});
