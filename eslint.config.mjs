import eslint from '@eslint/js';
import markdown from '@eslint/markdown';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import jsonc from 'eslint-plugin-jsonc';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import * as jsoncParser from 'jsonc-eslint-parser';
import { configs as tsLintConfig, parser as tsParser } from 'typescript-eslint';

import template from './eslint/plugin.mjs';
import sharedRules from './sharedRules.mjs';

const fenceProcessor = markdown.processors.markdown;

/**
 * The `markdown/markdown` processor, extended to lint the Markdown file
 * itself as well as its fences. The stock processor returns only the
 * fenced blocks, so a `.md` file it runs on is never linted as Markdown
 * and `markdown/recommended` goes silent over it. ESLint lints a string
 * block with the file's own config (the `markdown/commonmark` language
 * here), so the whole text goes first and its messages come back
 * unchanged; the fence messages go through the stock `postprocess`,
 * which maps them back onto the file. Taken from the service repo.
 *
 * @type {import("eslint").Linter.Processor} */
const markdownWithFences = {
  meta: { name: 'markdown-with-fences' },
  supportsAutofix: true,
  preprocess: (text, filename) => [text, ...fenceProcessor.preprocess(text, filename)],
  postprocess: ([fileMessages = [], ...fenceMessages], filename) => [
    ...fileMessages,
    ...fenceProcessor.postprocess(fenceMessages, filename),
  ],
};

/**
 * ESLint flat config for the template: the open-tomato family's config
 * from the service repo, narrowed from a workspace to this one package,
 * plus a React block for the web app and type-aware promise rules.
 *
 * @type {import("eslint").Linter.Config[]} */
export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      // The built web app; `bun run build:web` makes it.
      'src/web/dist/**',
      // The local SQLite database and its neighbours, gitignored.
      'data/**',
      // Loop state, gitignored.
      '.rafa/**',
      // Agent-harness prose (skills and agents) is not a lint target.
      '.claude/**',
      // drizzle-kit's generated snapshots and journal.
      'drizzle/**/meta/**',
    ],
  },
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.ts', '**/*.tsx'],
    extends: [
      eslint.configs.recommended,
      tsLintConfig.recommended,
    ],
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: 'readonly',
      },
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...sharedRules,
      // TypeScript resolves globals such as the `NodeJS` namespace itself.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx', '.d.ts'],
      },
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
  },
  {
    // The bug class these catch (an unawaited promise, an async callback
    // where a sync one is expected) is the one the SQLite transaction fix
    // dealt with. Markdown fences are virtual children of their file
    // (`src/web/README.md/0.ts`), which the project service cannot open.
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
    ignores: ['**/*.md/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    // The layout's import rules and the single drizzle `transaction` call,
    // from the local plugin in `eslint/plugin.mjs`.
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
    // bun's `expect(...).rejects` matchers are typed as returning void but
    // return promises; awaiting them is required.
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
    },
  },
  {
    // No `react-refresh`: the web build is `scripts/build-web.ts`, not Vite.
    files: ['src/web/**/*.tsx', 'tests/web/**/*.tsx'],
    languageOptions: {
      // These files run in the browser (or a DOM stand-in under test).
      globals: globals.browser,
    },
    extends: [
      react.configs.flat.recommended,
      reactHooks.configs.flat.recommended,
    ],
    rules: {
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['README.md', 'CLAUDE.md', 'docs/**/*.md', 'src/**/README.md'],
    plugins: {
      markdown,
    },
    extends: ['markdown/recommended'],
    processor: markdownWithFences,
    rules: {
      'markdown/no-missing-label-refs': 'off',
    },
  },
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    plugins: {
      jsonc,
      '@stylistic': stylistic,
    },
    rules: {
      'jsonc/indent': ['error', 2],
      '@stylistic/no-multiple-empty-lines': ['error', { 'max': 0, 'maxEOF': 0 }],
    },
  },
]);
