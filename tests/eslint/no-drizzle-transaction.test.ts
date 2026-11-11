import { join } from 'node:path';

import { describe, expect, it, test } from 'bun:test';
import { RuleTester } from 'eslint';
import { parser } from 'typescript-eslint';

import noDrizzleTransaction, { covers, TRANSACTION_CALL_ALLOWED } from '../../eslint/rules/no-drizzle-transaction.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const REPO_ROOT = join(import.meta.dir, '..', '..');

/** The absolute path ESLint would hand the rule for a repo-relative file. */
const at = (path: string): string => join(REPO_ROOT, path);

/** The planted call of the transaction test's control. */
const PLANTED = 'const x = 1;\nawait db.transaction(async (tx) => {});';

const DIRECT = { message: 'use transact(db, body) from src/data/active.ts' };

describe('covers', () => {
  test('covers src/ but not the Postgres transact nor files outside src/', () => {
    expect(covers('src/data/sqlite/transaction.ts')).toBe(true);
    expect(covers(TRANSACTION_CALL_ALLOWED)).toBe(false);
    expect(covers('tests/data/transaction.test.ts')).toBe(false);
  });
});

const ruleTester = new RuleTester({
  languageOptions: { parser },
});

ruleTester.run('template/no-drizzle-transaction', noDrizzleTransaction, {
  valid: [
    {
      name: 'the exempt Postgres transact calls transaction',
      filename: at(TRANSACTION_CALL_ALLOWED),
      code: PLANTED,
    },
    {
      name: 'a file outside src/ calls transaction',
      filename: at('tests/data/planted.ts'),
      code: PLANTED,
    },
    {
      name: 'a member access that is not a call',
      filename: at('src/data/planted.ts'),
      code: 'const begin = db.transaction;\nconst name = db[\'transaction\'];',
    },
    {
      name: 'a call of a plain function named transaction and of transact',
      filename: at('src/data/planted.ts'),
      code: 'transaction();\nawait transact(db, async (tx) => {});',
    },
  ],
  invalid: [
    {
      name: 'the transaction test\'s planted db.transaction( call',
      filename: at('src/data/planted.ts'),
      code: PLANTED,
      errors: [{ ...DIRECT, line: 2, type: 'CallExpression' }],
    },
    {
      name: 'an optional and a computed transaction call',
      filename: at('src/routes/info/get.flow.ts'),
      code: 'db?.transaction(body);\ndb[\'transaction\'](body);',
      errors: [
        { ...DIRECT, line: 1, type: 'CallExpression' },
        { ...DIRECT, line: 2, type: 'CallExpression' },
      ],
    },
  ],
});
