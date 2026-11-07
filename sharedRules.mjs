/**
 * The shared rule values, kept in one module so every config block applies
 * the same style. The `import/no-unresolved` ignore list names `#db`, the
 * import alias the bundler resolves and the resolver cannot.
 *
 * @type {import("eslint").Linter.RulesRecord} */
export default {
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/eol-last': ['error', 'always'],
  '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
  'global-require': 0,
  '@stylistic/implicit-arrow-linebreak': ['error', 'beside'],
  'arrow-body-style': ['error', 'as-needed'],
  '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
  '@stylistic/multiline-ternary': ['error', 'always'],
  '@stylistic/newline-per-chained-call': ['error', { 'ignoreChainWithDepth': 2 }],
  '@stylistic/no-multiple-empty-lines': ['error', { 'max': 1, 'maxEOF': 1 }],
  '@stylistic/no-multi-spaces': ['error', { exceptions: { Property: false }, 'ignoreEOLComments': true }],
  '@stylistic/no-tabs': ['error'],
  'no-var': 2,
  'no-undef': 2,
  'object-curly-spacing': ['error', 'always'],
  '@stylistic/quotes': ['error', 'single'],
  '@stylistic/semi': ['error', 'always'],
  'import/prefer-default-export': 0,
  // `#db` is the `imports` alias of `package.json`, which `tsc` resolves per
  // dialect; the import resolver follows it too today. The MCP SDK's
  // subpaths are left to `tsc`: their `./*` export pattern maps `types` to
  // a `*.js.d.ts` path the import resolver does not find (the service
  // repo's entry).
  'import/no-unresolved': ['error', { ignore: ['^bun:', '^#db$', '^@modelcontextprotocol/sdk/'] }],
  'import/order': ['error', {
    groups: [
      'type',
      'builtin',
      'external',
      'internal',
      'parent',
      'sibling',
      'index',
    ],
    'newlines-between': 'always',
    alphabetize: {
      order: 'asc',
      caseInsensitive: true,
    },
  }],
};
