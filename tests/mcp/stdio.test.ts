/**
 * The stdio server as a client meets it: `src/mcp/server.ts` run as a child process, fed the
 * protocol's opening, a `tools/list` and one tool call on stdin. Over stdio, stdout carries the
 * protocol, so every stdout line must be a JSON-RPC message, and the log lines, the tool call's
 * among them, must arrive on stderr instead.
 *
 * The server runs as a child and is never imported: `createMCP` starts on call and exits the
 * process if setup throws.
 *
 * @module
 */

import { describe, expect, test } from 'bun:test';

import { REPO_ROOT } from '../docs/markdown';

/** Long enough for a cold `bun` start; the server exits on its own once stdin ends. */
const EXIT_WAIT_MS = 10_000;
const TEST_TIMEOUT_MS = 15_000;

/** The messages a client sends: the opening, a `tools/list`, then a call of `service_info`. */
const REQUESTS = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'service_info', arguments: {} } },
];

type Line = Readonly<Record<string, unknown>>;

/** Each non-empty line of `text`, parsed, or the raw text when it is not a JSON object. */
function parsedLines(text: string): ReadonlyArray<Line | string> {
  return text.split('\n').filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === 'object' && parsed !== null
          ? parsed as Line
          : line;
      } catch {
        return line;
      }
    });
}

/** Runs the stdio server over `REQUESTS` and returns what it wrote to each stream. */
async function runStdioServer(): Promise<{ readonly stdout: string, readonly stderr: string, readonly exitCode: number }> {
  const child = Bun.spawn([process.execPath, 'src/mcp/server.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      MCP_TRANSPORT: 'stdio',
      DATABASE_URL: ':memory:',
      OPEN_NOTEBOOK_URL: '',
      LOG_LEVEL: 'debug',
      LOG_FORMAT: 'json',
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  void child.stdin.write(REQUESTS.map((request) => JSON.stringify(request)).join('\n') + '\n');
  void child.stdin.end();
  const timer = setTimeout(() => child.kill(), EXIT_WAIT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

describe('the stdio MCP server', () => {
  test('writes only JSON-RPC messages to stdout, answers every request, and logs on stderr', async () => {
    const { stdout, stderr, exitCode } = await runStdioServer();

    const out = parsedLines(stdout);
    const logs = parsedLines(stderr).filter((line): line is Line => typeof line !== 'string');
    const toolLine = logs.find((line) => line.msg === 'service info read');

    expect(exitCode).toBe(0);
    expect(out.filter((line) => typeof line === 'string' || line.jsonrpc !== '2.0')).toEqual([]);
    expect(out.map((line) => (typeof line === 'string'
      ? undefined
      : line.id))).toEqual([1, 2, 3]);
    expect(logs.some((line) => line.msg === 'registered MCP tools')).toBe(true);
    expect(typeof toolLine?.traceId).toBe('string');
  }, TEST_TIMEOUT_MS);
});
