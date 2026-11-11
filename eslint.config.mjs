import baseConfig from '@open-tomato/eslint-config';
import markdownFences from '@open-tomato/eslint-config/markdown-fences';
import reactConfig from '@open-tomato/eslint-config/react';
import { typeAware } from '@open-tomato/eslint-config/type-aware';

import template from './eslint/plugin.mjs';

/** The folders that hold React code: the web app and its tests. */
const WEB_DIRS = ['src/web', 'tests/web'];

/**
 * The React flavor's blocks, each narrowed to the web folders. The flavor runs the hooks rules on
 * every code file, and the server's own functions named `use...` (`useToken`, a `use` callback)
 * are not hooks.
 */
const webReactConfig = reactConfig.map((block) => ({
  ...block,
  files: (block.files ?? []).flatMap((pattern) => WEB_DIRS.map((dir) => `${dir}/${pattern}`)),
}));

/**
 * ESLint flat config for the template: the shared `@open-tomato/eslint-config` base with its
 * React, type-aware and Markdown-fence flavors, and below them only what is this project's own.
 *
 * @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      // The built web app; `bun run build:web` makes it.
      'src/web/dist/**',
      // The local SQLite database and its neighbours, gitignored.
      'data/**',
      // drizzle-kit's generated snapshots and journal.
      'drizzle/**/meta/**',
    ],
  },
  ...baseConfig,
  // No `/vite`: the web build is `scripts/build-web.ts`, not Vite.
  ...webReactConfig,
  // The bug class these catch (an unawaited promise, an async callback where a sync one is
  // expected) is the one the SQLite transaction fix dealt with.
  ...typeAware({
    tsconfigRootDir: import.meta.dirname,
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
  }),
  ...markdownFences,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts', '**/*.tsx'],
    rules: {
      // `#db` is the dialect alias in package.json `imports`, and the MCP SDK publishes subpath
      // exports the import resolver does not read.
      'import/no-unresolved': ['error', { ignore: ['^bun:', '^#db$', '^@modelcontextprotocol/sdk/'] }],
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // The layout's import rules and the single drizzle `transaction` call, from the local plugin
    // in `eslint/plugin.mjs`.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      template,
    },
    rules: {
      'template/layer-imports': 'error',
      'template/no-drizzle-transaction': 'error',
    },
  },
  {
    // bun's `expect(...).rejects` matchers are typed as returning void but return promises, and
    // the helpers beside the tests await them too; the shared flavor turns this off for
    // `*.test.ts` files only.
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
    },
  },
];
