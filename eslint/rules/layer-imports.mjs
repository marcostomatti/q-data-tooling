import { posix, relative, resolve, sep } from 'node:path';

/**
 * The repository root, two directories above this file: the rule names files
 * by their repo-relative posix path (`src/routes/info/get.flow.ts`) whatever
 * directory ESLint runs from.
 */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * A file's role is the last dot segment of its name before the extension:
 * `get.flow.ts` is `flow`, `http.ts` is `http`.
 *
 * @param {string} path a posix path or a bare specifier
 * @returns {string} the role
 */
export function roleOf(path) {
  const name = posix.basename(path).replace(/\.tsx?$/, '');
  return name.slice(name.lastIndexOf('.') + 1);
}

/**
 * Whether a path lies under a directory (the directory itself does not).
 *
 * @param {string} path a repo-relative posix path or a bare specifier
 * @param {string} directory a repo-relative posix directory such as `src/http`
 * @returns {boolean} true when the path starts with `<directory>/`
 */
export const under = (path, directory) => path.startsWith(`${directory}/`);

/**
 * Whether an import target is drizzle-orm or one of its subpaths.
 *
 * @param {string} target a resolved import target
 * @returns {boolean} true for `drizzle-orm` and `drizzle-orm/...`
 */
export const isDrizzle = (target) => target === 'drizzle-orm' || target.startsWith('drizzle-orm/');

/**
 * Whether an import target is transport: `src/http`, `src/mcp`, an `http.ts`
 * or a `tool.ts`.
 *
 * @param {string} target a resolved import target
 * @returns {boolean} true for a transport target
 */
export const isTransport = (target) => under(target, 'src/http') ||
  under(target, 'src/mcp') ||
  roleOf(target) === 'http' ||
  roleOf(target) === 'tool';

/**
 * One layer rule: the files it applies to and the import targets it forbids
 * them. `name` is the entry's name in the report message.
 *
 * @typedef {object} ImportRule
 * @property {string} name the entry's name, such as `flow`
 * @property {(file: string) => boolean} applies whether the rule covers a repo-relative file
 * @property {(target: string) => boolean} forbids whether the rule forbids a resolved target
 * @property {NamedImports} [names] the one target the rule admits only some names from
 */

/**
 * A target a rule admits only some names from: a value name may be imported
 * either way, a type name only as a type (`import type { Log }` or
 * `import { type Log }`). Any other name, a default or a namespace import, and
 * an `export * from` of the target are reported.
 *
 * @typedef {object} NamedImports
 * @property {string} target the repo-relative target, such as `src/logging.ts`
 * @property {readonly string[]} values the value names admitted
 * @property {readonly string[]} types the names admitted as a type only
 */

/**
 * The six layer rules, in the order `tests/layout.test.ts` held them. A file
 * may match more than one; an import is reported once, under the first entry
 * that forbids it.
 *
 * @type {readonly ImportRule[]}
 */
export const IMPORT_RULES = [
  {
    // A flow reaches no transport, no data layer, no drizzle and no repository,
    // and takes from src/logging.ts only `scoped` and the type `Log`: the run
    // context hands it a traced log, so it never builds or domains its own.
    name: 'flow',
    applies: (file) => roleOf(file) === 'flow',
    forbids: (target) => isTransport(target) ||
      under(target, 'src/data') ||
      target === '#db' ||
      isDrizzle(target) ||
      roleOf(target) === 'repository',
    names: { target: 'src/logging.ts', values: ['scoped'], types: ['Log'] },
  },
  {
    name: 'route http.ts',
    applies: (file) => under(file, 'src/routes') && roleOf(file) === 'http',
    forbids: (target) => under(target, 'src/mcp') || roleOf(target) === 'tool',
  },
  {
    name: 'tool.ts',
    applies: (file) => roleOf(file) === 'tool',
    forbids: (target) => under(target, 'src/http') || roleOf(target) === 'http',
  },
  {
    name: 'src/http',
    applies: (file) => under(file, 'src/http'),
    forbids: (target) => under(target, 'src/mcp'),
  },
  {
    name: 'src/mcp',
    applies: (file) => under(file, 'src/mcp'),
    forbids: (target) => under(target, 'src/http'),
  },
  {
    // An entity is plain: zod and other entities, nothing else.
    name: 'entity',
    applies: (file) => under(file, 'src/entities'),
    forbids: (target) => target !== 'zod' && !under(target, 'src/entities'),
  },
];

/** The directories a layer message names by directory, checked before a target's role. */
const LAYER_DIRECTORIES = ['src/http', 'src/mcp', 'src/data', 'src/entities'];

/** The roles a layer message names by role. */
const LAYER_ROLES = new Set(['http', 'tool', 'repository']);

/**
 * The layer an import target belongs to, as the report message names it:
 * `in src/data`, `the #db alias`, `drizzle-orm`, `a tool.ts`, `the package zod`.
 *
 * @param {string} target a resolved import target
 * @param {boolean} isPath whether the target is a resolved relative specifier
 * @returns {string} the layer's phrase
 */
export function layerOf(target, isPath) {
  if (target === '#db') {
    return 'the #db alias';
  }
  if (isDrizzle(target)) {
    return 'drizzle-orm';
  }
  const directory = LAYER_DIRECTORIES.find((candidate) => under(target, candidate));
  if (directory !== undefined) {
    return `in ${directory}`;
  }
  const role = roleOf(target);
  if (LAYER_ROLES.has(role)) {
    return role === 'http'
      ? 'an http.ts'
      : `a ${role}.ts`;
  }
  return isPath
    ? `in ${posix.dirname(target)}`
    : `the package ${target}`;
}

/**
 * Whether a specifier is relative (`./`, `../`) rather than bare (`zod`, `#db`).
 *
 * @param {string} specifier the specifier as written
 * @returns {boolean} true for a relative specifier
 */
export const isRelative = (specifier) => specifier.startsWith('./') || specifier.startsWith('../');

/**
 * Resolves a specifier against the importing file: a relative one becomes a
 * repo-relative path, a bare one (`zod`, `#db`) stays as is.
 *
 * @param {string} file the importing file's repo-relative posix path
 * @param {string} specifier the specifier as written
 * @returns {string} the import target
 */
export function targetOf(file, specifier) {
  return isRelative(specifier)
    ? posix.join(posix.dirname(file), specifier)
    : specifier;
}

/**
 * The first rule entry that covers a file and forbids a target, if any.
 *
 * @param {string} file the importing file's repo-relative posix path
 * @param {string} target the resolved import target
 * @returns {ImportRule | undefined} the breaking entry
 */
export function brokenRule(file, target) {
  return IMPORT_RULES.find((rule) => rule.applies(file) && rule.forbids(target));
}

/**
 * The first rule entry that covers a file and admits only some names from a
 * target, if any.
 *
 * @param {string} file the importing file's repo-relative posix path
 * @param {string} target the resolved import target
 * @returns {ImportRule | undefined} the entry whose `names` covers the target
 */
export function namedRule(file, target) {
  return IMPORT_RULES.find((rule) => rule.applies(file) && rule.names?.target === target);
}

/**
 * The imported or re-exported name of one specifier, and whether it is taken
 * as a type only. A default import is `default`, a namespace import `*`.
 *
 * @param {any} specifier an import or export specifier node
 * @param {boolean} isTypeDeclaration whether the whole declaration is `import type` or `export type`
 * @returns {{ name: string, isType: boolean }} the name and its kind
 */
function nameOf(specifier, isTypeDeclaration) {
  const isType = isTypeDeclaration || specifier.importKind === 'type' || specifier.exportKind === 'type';
  switch (specifier.type) {
    case 'ImportDefaultSpecifier':
      return { name: 'default', isType };
    case 'ImportNamespaceSpecifier':
      return { name: '*', isType };
    case 'ImportSpecifier':
      return { name: specifier.imported.name ?? specifier.imported.value, isType };
    default:
      return { name: specifier.local.name ?? specifier.local.value, isType };
  }
}

/**
 * Whether a `names` entry admits one name of the given kind.
 *
 * @param {NamedImports} names the entry's admitted names
 * @param {{ name: string, isType: boolean }} imported the name and its kind
 * @returns {boolean} true for an admitted value name, or an admitted type name taken as a type
 */
export const admits = (names, { name, isType }) => names.values.includes(name) ||
  (isType && names.types.includes(name));

/**
 * The names a `names` entry admits, as the report message lists them.
 *
 * @param {NamedImports} names the entry's admitted names
 * @returns {string} such as `scoped and import type { Log }`
 */
const admittedOf = (names) => [
  ...names.values,
  ...names.types.map((name) => `import type { ${name} }`),
].join(' and ');

/**
 * The linted file's repo-relative posix path.
 *
 * @param {string} cwd ESLint's working directory, for a relative filename
 * @param {string} filename the linted file, as ESLint names it
 * @returns {string} the path, such as `src/routes/info/get.flow.ts`
 */
function repoPathOf(cwd, filename) {
  const path = relative(REPO_ROOT, resolve(cwd, filename));
  return path.split(sep).join('/');
}

/**
 * `template/layer-imports`: the layout's import rules (a flow imports no
 * transport and no data layer and only `scoped` and the type `Log` from
 * `src/logging.ts`, `src/http` and `src/mcp` never import each
 * other, an entity imports only zod and other entities, and so on), checked
 * on every `import ... from`, `export ... from` and `export * from` source.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const layerImports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid an import that crosses the layout\'s layer rules.',
    },
    schema: [],
    messages: {
      forbidden: 'The \'{{entry}}\' entry of template/layer-imports forbids this import: \'{{specifier}}\' is {{layer}}.',
      forbiddenName: 'The \'{{entry}}\' entry of template/layer-imports admits only {{admitted}} from \'{{specifier}}\', not \'{{name}}\'.',
    },
  },
  create(context) {
    const file = repoPathOf(context.cwd, context.filename);
    /** @param {import('estree').ImportDeclaration | import('estree').ExportNamedDeclaration | import('estree').ExportAllDeclaration} node */
    const check = (node) => {
      const specifier = node.source?.value;
      if (typeof specifier !== 'string') {
        return;
      }
      const target = targetOf(file, specifier);
      const rule = brokenRule(file, target);
      if (rule !== undefined) {
        context.report({
          node,
          messageId: 'forbidden',
          data: { entry: rule.name, specifier, layer: layerOf(target, isRelative(specifier)) },
        });
        return;
      }
      checkNames(node, specifier, target);
    };
    /**
     * Reports each name a `names` entry does not admit from its target.
     *
     * @param {any} node the import or export declaration
     * @param {string} specifier the specifier as written
     * @param {string} target the resolved import target
     */
    const checkNames = (node, specifier, target) => {
      const rule = namedRule(file, target);
      if (rule?.names === undefined) {
        return;
      }
      const data = { entry: rule.name, specifier, admitted: admittedOf(rule.names) };
      if (node.type === 'ExportAllDeclaration') {
        context.report({ node, messageId: 'forbiddenName', data: { ...data, name: '*' } });
        return;
      }
      const isTypeDeclaration = node.importKind === 'type' || node.exportKind === 'type';
      for (const part of node.specifiers ?? []) {
        const imported = nameOf(part, isTypeDeclaration);
        if (!admits(rule.names, imported)) {
          context.report({ node: part, messageId: 'forbiddenName', data: { ...data, name: imported.name } });
        }
      }
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

export default layerImports;
