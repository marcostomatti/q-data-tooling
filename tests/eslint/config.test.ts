import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const REPO_ROOT = join(import.meta.dir, '..', '..');

const eslint = new ESLint({
  cwd: REPO_ROOT,
  overrideConfigFile: join(REPO_ROOT, 'eslint.config.mjs'),
});

// The type-aware parser only lints files the tsconfig knows, so each case
// borrows the path of a real file; the text is what gets linted.
const FLOW_PATH = 'src/routes/info/get.flow.ts';
const OTHER_SRC_PATH = 'src/routes/info/http.ts';
const PG_TRANSACTION_PATH = 'src/data/pg/transaction.ts';

/** The rule ids ESLint reports for `text` linted as the repo-relative `path`. */
const ruleIdsFor = async (text: string, path: string): Promise<string[]> => {
  const [result] = await eslint.lintText(text, { filePath: join(REPO_ROOT, path) });
  const fatal = result?.messages.find((message) => message.fatal);
  if (fatal) {
    throw new Error(`${path} did not parse: ${fatal.message}`);
  }
  return (result?.messages ?? []).flatMap((message) => [message.ruleId ?? []].flat());
};

const TEMPLATE_RULES = ['template/layer-imports', 'template/no-drizzle-transaction'];

const CALL = 'export const run = async (db: any): Promise<void> => {\n  await db.transaction(async () => {});\n};\n';

describe('eslint.config.mjs local rules', () => {
  test('reports template/layer-imports for a flow importing the data layer', async () => {
    const text = 'import { db } from \'../../data/active.ts\';\n\nexport const flow = (): unknown => db;\n';

    const ids = await ruleIdsFor(text, FLOW_PATH);

    expect(ids).toContain('template/layer-imports');
  });

  test('reports template/no-drizzle-transaction for db.transaction( under src/', async () => {
    const ids = await ruleIdsFor(CALL, OTHER_SRC_PATH);

    expect(ids).toContain('template/no-drizzle-transaction');
  });

  test('reports neither rule for the call in src/data/pg/transaction.ts', async () => {
    const ids = await ruleIdsFor(CALL, PG_TRANSACTION_PATH);

    expect(ids.filter((id) => TEMPLATE_RULES.includes(id))).toEqual([]);
  });
});
