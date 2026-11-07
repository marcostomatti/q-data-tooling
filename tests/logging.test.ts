import { describe, expect, test } from 'bun:test';

import {
  DOMAIN_FIELD,
  inDomain,
  SCOPE_FIELD,
  scoped,
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
