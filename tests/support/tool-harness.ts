import type { Db } from '../../src/data/repositories/db.ts';
import type { Log } from '../../src/logging.ts';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerTools, type ToolDefinition } from '../../src/mcp/register.ts';

import { captureLog } from './capture-log.ts';

type RawResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

/** What a client sees of one call: whether it failed, and the JSON the envelope carried. */
export interface ToolOutcome {
  readonly failed: boolean
  readonly body: unknown
}

/** A client connected in memory to a bare server holding the given tools, over the given database. */
export interface ToolClient {
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>
}

/**
 * Registers the definitions on a bare server and connects a client to it, so a call crosses the
 * same schema validation and the same result envelope a real client's call does. `log` is the
 * base log each `run` is handed; a test that reads the lines passes its own capturing fake.
 */
export async function connectTools(definitions: readonly ToolDefinition[], db: Db, log: Log = captureLog().log): Promise<ToolClient> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server, db, definitions, log);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return {
    async call(name, args): Promise<ToolOutcome> {
      const raw = (await client.callTool({ name, arguments: args })) as RawResult;
      const text = raw.content[0]?.text;
      // A schema refusal comes back from the SDK as plain text, not JSON, so keep it as text.
      let body: unknown;
      try {
        body = JSON.parse(text ?? '');
      } catch {
        body = text;
      }
      return { failed: raw.isError === true, body };
    },
  };
}

/** The text of a failed call, whatever its envelope: a JSON error object or the SDK's plain refusal. */
export function failureText(outcome: ToolOutcome): string {
  return typeof outcome.body === 'string'
    ? outcome.body
    : JSON.stringify(outcome.body);
}

/**
 * A database that fails the test on first use, for a call that must be refused by the schema
 * before any repository is reached. It records nothing because it must never be touched.
 */
export function untouchableDb(): Db {
  const refuse = (): never => {
    throw new Error('the database was touched by a call the schema should have refused');
  };
  return new Proxy({} as Db, { get: refuse });
}

/** The id at `index`, or a loud failure: an absent row would otherwise read as a pass. */
export function idOf(rows: readonly { readonly id: number }[], index = 0): number {
  const id = rows[index]?.id;
  if (id === undefined) throw new Error(`the arrangement produced no row at index ${index}`);
  return id;
}
