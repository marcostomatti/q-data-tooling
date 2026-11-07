import { describe, expect, test } from 'bun:test';

import packageJson from '../../../package.json' with { type: 'json' };
import { APP } from '../../../src/app-config.ts';
import { inDomain } from '../../../src/logging.ts';
import { getServiceInfo } from '../../../src/routes/info/get.flow.ts';
import { captureLog } from '../../support/capture-log.ts';

/** A log nothing reads, for the tests that check only the answer. */
const { log } = captureLog();

describe('getServiceInfo flow, called with no transport', () => {
  test('reports the notebook off when OPEN_NOTEBOOK_URL is unset', () => {
    const info = getServiceInfo({}, { env: {}, dialect: 'sqlite', log });
    expect(info).toEqual({
      id: APP.id,
      name: APP.name,
      version: packageJson.version,
      dialect: 'sqlite',
      notebook: false,
    });
  });

  test('reports the notebook off when OPEN_NOTEBOOK_URL is not a usable address', () => {
    expect(getServiceInfo({}, { env: { OPEN_NOTEBOOK_URL: 'not a url' }, dialect: 'sqlite', log }).notebook).toBe(false);
  });

  test('reports the notebook on when OPEN_NOTEBOOK_URL names an address', () => {
    const info = getServiceInfo({}, { env: { OPEN_NOTEBOOK_URL: 'http://localhost:5055' }, dialect: 'sqlite', log });
    expect(info.notebook).toBe(true);
  });

  test.each(['sqlite', 'pg'] as const)('echoes the %s dialect it is given', (dialect) => {
    expect(getServiceInfo({}, { env: {}, dialect, log }).dialect).toBe(dialect);
  });

  test('follows the env passed on each call', () => {
    const on = getServiceInfo({}, { env: { OPEN_NOTEBOOK_URL: 'http://localhost:5055' }, dialect: 'pg', log });
    const off = getServiceInfo({}, { env: {}, dialect: 'pg', log });
    expect([on.notebook, off.notebook]).toEqual([true, false]);
  });

  test('scopes its one line at get and writes it at debug with step read, carrying the domain bound above', () => {
    const captured = captureLog();

    getServiceInfo({}, { env: {}, dialect: 'sqlite', log: inDomain(captured.log, 'Info') });

    expect(captured.records).toEqual([
      { domain: 'Info', scope: 'get', step: 'read', dialect: 'sqlite', notebook: false, level: 'debug', msg: 'service info read' },
    ]);
  });
});
