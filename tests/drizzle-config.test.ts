import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import config, { dialectFolderOf, kitConfigFor } from '../drizzle.config.ts';
import packageJson from '../package.json' with { type: 'json' };

const ROOT = join(import.meta.dir, '..');

describe('dialectFolderOf', () => {
  test('reads the dialect folder out of a #db target', () => {
    expect(dialectFolderOf('./src/data/sqlite/index.ts')).toBe('sqlite');
    expect(dialectFolderOf('./src/data/pg/index.ts')).toBe('pg');
  });

  test('rejects a target outside the dialect-folder shape', () => {
    expect(() => dialectFolderOf('./src/data/mysql/index.ts')).toThrow('#db target');
    expect(() => dialectFolderOf('./src/data/sqlite/client.ts')).toThrow('#db target');
    expect(() => dialectFolderOf('src/data/sqlite/index.ts')).toThrow('#db target');
  });
});

describe('kitConfigFor', () => {
  test('takes the dialect, schema and output folder from the SQLite target', () => {
    expect(kitConfigFor('./src/data/sqlite/index.ts', undefined)).toEqual({
      dialect: 'sqlite',
      schema: './src/data/sqlite/tables',
      out: './drizzle/sqlite',
    });
  });

  test('takes the dialect, schema and output folder from the Postgres target', () => {
    expect(kitConfigFor('./src/data/pg/index.ts', undefined)).toEqual({
      dialect: 'postgresql',
      schema: './src/data/pg/tables',
      out: './drizzle/pg',
    });
  });

  test('passes DATABASE_URL on as the credentials when there is one', () => {
    const url = 'postgres://app@127.0.0.1:5432/app';
    expect(kitConfigFor('./src/data/pg/index.ts', url).dbCredentials).toEqual({ url });
  });
});

describe('the drizzle-kit config', () => {
  test('follows the #db target package.json names', () => {
    const folder = dialectFolderOf(packageJson.imports['#db']);
    expect(config.schema).toBe(`./src/data/${folder}/tables`);
    expect(config.out).toBe(`./drizzle/${folder}`);
  });

  test('has an initial migration in the tree for every dialect folder', () => {
    for (const folder of ['sqlite', 'pg']) {
      expect(existsSync(join(ROOT, 'drizzle', folder, '0000_init.sql'))).toBe(true);
    }
  });
});
