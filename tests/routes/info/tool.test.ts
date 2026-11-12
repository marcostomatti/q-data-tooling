import { describe, expect, test } from 'bun:test';

import packageJson from '../../../package.json' with { type: 'json' };
import { APP } from '../../../src/app-config.ts';
import { DIALECT } from '../../../src/data/active.ts';
import { DOMAIN, InfoInputSchema, ServiceInfoSchema } from '../../../src/routes/info/contract.ts';
import { getServiceInfo } from '../../../src/routes/info/get.flow.ts';
import { infoTool } from '../../../src/routes/info/tool.ts';
import { captureLog } from '../../support/capture-log.ts';
import { connectTools, untouchableDb } from '../../support/tool-harness.ts';

/** A log nothing reads, for the tests that check only the answer. */
const { log } = captureLog();

describe('getServiceInfo', () => {
  test('answers the app, the package version and the active dialect, with the notebook off when its URL is unset', () => {
    const info = getServiceInfo({}, { env: {}, dialect: DIALECT, log });
    expect(info).toEqual({ id: APP.id, name: APP.name, version: packageJson.version, dialect: DIALECT, notebook: false });
    expect(ServiceInfoSchema.parse(info)).toEqual(info);
  });

  test('the default build runs on Postgres and the version is a real one', () => {
    expect(getServiceInfo({}, { env: {}, dialect: DIALECT, log }).dialect).toBe('pg');
    expect(getServiceInfo({}, { env: {}, dialect: DIALECT, log }).version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('reports the notebook as configured when OPEN_NOTEBOOK_URL names a usable address', () => {
    expect(getServiceInfo({}, { env: { OPEN_NOTEBOOK_URL: 'http://localhost:5055' }, dialect: DIALECT, log }).notebook).toBe(true);
  });

  test('reports the notebook off for an address the notebook config refuses', () => {
    expect(getServiceInfo({}, { env: { OPEN_NOTEBOOK_URL: 'not a url' }, dialect: DIALECT, log }).notebook).toBe(false);
    expect(getServiceInfo({}, { env: { OPEN_NOTEBOOK_URL: '   ' }, dialect: DIALECT, log }).notebook).toBe(false);
  });
});

describe('InfoInputSchema', () => {
  test('accepts the empty object and refuses any field', () => {
    expect(InfoInputSchema.safeParse({}).success).toBe(true);
    expect(InfoInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('the service_info tool', () => {
  test('is defined on the shared schema object and marked read-only', () => {
    expect(infoTool.name).toBe('service_info');
    expect(infoTool.input).toBe(InfoInputSchema);
    expect(infoTool.annotations?.readOnlyHint).toBe(true);
  });

  test('a call answers the service info without touching the database', async () => {
    const tools = await connectTools([infoTool], untouchableDb());
    const outcome = await tools.call('service_info', {});
    expect(outcome.failed).toBe(false);
    expect(outcome.body).toEqual(getServiceInfo({}, { env: process.env, dialect: DIALECT, log }));
  });

  test('a call writes the flow\'s line under the Info domain, which tool.ts binds', async () => {
    const captured = captureLog();
    const tools = await connectTools([infoTool], untouchableDb(), captured.log);

    await tools.call('service_info', {});

    expect(captured.records).toHaveLength(1);
    expect(captured.records[0]).toMatchObject({ domain: DOMAIN, scope: 'get', step: 'read', level: 'debug' });
    expect(DOMAIN).toBe('Info');
  });

  test('a call with a stray argument is refused', async () => {
    const tools = await connectTools([infoTool], untouchableDb());
    const outcome = await tools.call('service_info', { extra: 1 });
    expect(outcome.failed).toBe(true);
  });
});
