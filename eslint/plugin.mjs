import layerImports from './rules/layer-imports.mjs';
import noDrizzleTransaction from './rules/no-drizzle-transaction.mjs';

/**
 * The template's local ESLint plugin, registered in `eslint.config.mjs`
 * under the prefix `template/`:
 *
 * - `template/layer-imports`, the layout's import rules (a flow imports no
 *   transport and no data layer and only `scoped` and the type `Log` from
 *   `src/logging.ts`, `src/http` and `src/mcp` never import each
 *   other, an entity imports only zod and other entities, and so on).
 * - `template/no-drizzle-transaction`, no call of drizzle's `transaction`
 *   under `src/` outside the Postgres `transact`.
 *
 * @type {import('eslint').ESLint.Plugin}
 */
const plugin = {
  meta: {
    name: 'template',
  },
  rules: {
    'layer-imports': layerImports,
    'no-drizzle-transaction': noDrizzleTransaction,
  },
};

export default plugin;
