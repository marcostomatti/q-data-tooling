import { describe, expect, test } from 'bun:test';

import {
  DOMAIN_FIELD,
  inDomain,
  SCOPE_FIELD,
  scoped,
  stderrLogger,
  STEP_FIELD,
  TRACE_ID_FIELD,
} from '../src/logging.ts';

import { captureLog } from './support/capture-log.ts';

describe('the breadcrumb fields', () => {
  test('are named as the service repo names them', () => {
    expect([TRACE_ID_FIELD, DOMAIN_FIELD, SCOPE_FIELD, STEP_FIELD]).toEqual(['traceId', 'domain', 'scope', 'step']);
  });
});

describe('inDomain and scoped', () => {
  test('inDomain then scoped give a record with the domain and the scope', () => {
    const { log, records } = captureLog();

    scoped(inDomain(log, 'Widgets'), 'create').info({ widgetId: 7 }, 'widget created');

    expect(records).toEqual([
      { domain: 'Widgets', scope: 'create', widgetId: 7, level: 'info', msg: 'widget created' },
    ]);
  });

  test('a nested scoped replaces the scope and keeps the domain', () => {
    const { log, records } = captureLog();
    const outer = scoped(inDomain(log, 'Widgets'), 'create');

    scoped(outer, 'notify').debug({}, 'sent');
    outer.debug({}, 'done');

    expect(records).toEqual([
      { domain: 'Widgets', scope: 'notify', level: 'debug', msg: 'sent' },
      { domain: 'Widgets', scope: 'create', level: 'debug', msg: 'done' },
    ]);
  });

  test('a call\'s step reaches that call\'s record and is not bound on the logger', () => {
    const { log, records } = captureLog();
    const create = scoped(inDomain(log, 'Widgets'), 'create');

    create.trace({ step: 'insert' }, 'inserting');
    create.warn({}, 'slow');

    expect(records[0]).toEqual({ domain: 'Widgets', scope: 'create', step: 'insert', level: 'trace', msg: 'inserting' });
    expect(records[1]).toEqual({ domain: 'Widgets', scope: 'create', level: 'warn', msg: 'slow' });
    expect(records[1]).not.toHaveProperty('step');
  });

  test('binding leaves the parent logger without the bound fields', () => {
    const { log, records } = captureLog();

    scoped(inDomain(log, 'Widgets'), 'create');
    log.error({ code: 'E_X' }, 'failed');

    expect(records).toEqual([{ code: 'E_X', level: 'error', msg: 'failed' }]);
  });
});

describe('stderrLogger', () => {
  /** A stderr logger at `level` whose lines are parsed into `lines` instead of written. */
  function captureStderr(level?: string): { log: ReturnType<typeof stderrLogger>; lines: Array<Record<string, unknown>> } {
    const lines: Array<Record<string, unknown>> = [];
    const write = (line: string): void => {
      expect(line.endsWith('\n')).toBe(true);
      lines.push(JSON.parse(line) as Record<string, unknown>);
    };
    return {
      log: stderrLogger('mcp', level === undefined
        ? { write }
        : { write, level }),
      lines,
    };
  }

  test('writes one pino-shaped line holding the bindings, the context and the message', () => {
    const { log, lines } = captureStderr('info');

    scoped(inDomain(log, 'Widgets'), 'create').info({ step: 'insert', widgetId: 7 }, 'widget created');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 30,
      service: 'mcp',
      domain: 'Widgets',
      scope: 'create',
      step: 'insert',
      widgetId: 7,
      msg: 'widget created',
    });
    expect(typeof lines[0]?.time).toBe('number');
  });

  test('drops a line below its level and keeps one at or above it', () => {
    const { log, lines } = captureStderr('warn');

    log.trace({}, 'a');
    log.debug({}, 'b');
    log.info({}, 'c');
    log.warn({}, 'd');
    log.error({}, 'e');

    expect(lines.map((line) => [line.level, line.msg])).toEqual([[40, 'd'], [50, 'e']]);
  });

  test('an unknown level name falls back to info, and silent writes nothing', () => {
    const unknown = captureStderr('loud');
    unknown.log.debug({}, 'hidden');
    unknown.log.info({}, 'shown');
    const silent = captureStderr('silent');
    silent.log.error({}, 'hidden');

    expect(unknown.lines.map((line) => line.msg)).toEqual(['shown']);
    expect(silent.lines).toEqual([]);
  });

  test('reads LOG_LEVEL when no level is given', () => {
    const saved = process.env['LOG_LEVEL'];
    process.env['LOG_LEVEL'] = 'debug';
    try {
      const { log, lines } = captureStderr();
      log.trace({}, 'hidden');
      log.debug({}, 'shown');

      expect(lines.map((line) => line.msg)).toEqual(['shown']);
    } finally {
      if (saved === undefined) delete process.env['LOG_LEVEL'];
      else process.env['LOG_LEVEL'] = saved;
    }
  });

  test('writes an Error with its type and message, and a line it cannot serialize with its message only', () => {
    const { log, lines } = captureStderr('info');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    log.error({ step: 'respond', err: new TypeError('bad') }, 'failed');
    log.warn({ circular }, 'odd');

    expect(lines[0]?.err).toMatchObject({ type: 'TypeError', message: 'bad' });
    expect(lines[1]).toMatchObject({ level: 40, service: 'mcp', msg: 'odd' });
    expect(lines[1]).not.toHaveProperty('circular');
  });
});
