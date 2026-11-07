import { relative, resolve, sep } from 'node:path';

/**
 * The repository root, two directories above this file: the rule names files
 * by their repo-relative posix path (`src/data/pg/transaction.ts`) whatever
 * directory ESLint runs from.
 */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * The one file that may call drizzle's `transaction`: the Postgres
 * `transact`, which wraps it so the rest of the code calls one function on
 * both dialects.
 */
export const TRANSACTION_CALL_ALLOWED = 'src/data/pg/transaction.ts';

/**
 * Whether the rule covers a file: any file under `src/` except
 * {@link TRANSACTION_CALL_ALLOWED}.
 *
 * @param {string} file a repo-relative posix path
 * @returns {boolean} true when a `transaction` call in the file is reported
 */
export const covers = (file) => file.startsWith('src/') && file !== TRANSACTION_CALL_ALLOWED;

/**
 * Whether a call's callee is a member named `transaction`: `db.transaction`,
 * `db?.transaction` or `db['transaction']`.
 *
 * @param {import('estree').CallExpression['callee']} callee the call's callee
 * @returns {boolean} true for a `transaction` member
 */
export function isTransactionMember(callee) {
  if (callee.type !== 'MemberExpression') {
    return false;
  }
  const { property } = callee;
  return callee.computed
    ? property.type === 'Literal' && property.value === 'transaction'
    : property.type === 'Identifier' && property.name === 'transaction';
}

/**
 * The linted file's repo-relative posix path.
 *
 * @param {string} cwd ESLint's working directory, for a relative filename
 * @param {string} filename the linted file, as ESLint names it
 * @returns {string} the path, such as `src/data/pg/transaction.ts`
 */
function repoPathOf(cwd, filename) {
  const path = relative(REPO_ROOT, resolve(cwd, filename));
  return path.split(sep).join('/');
}

/**
 * `template/no-drizzle-transaction`: no code under `src/` calls drizzle's
 * `transaction` directly. On SQLite drizzle commits an async callback at its
 * first `await`, so every transaction goes through `transact(db, body)` from
 * `src/data/active.ts`; only the Postgres `transact` itself, in
 * `src/data/pg/transaction.ts`, calls `transaction`. Any call of a member
 * named `transaction` is reported, on the call expression.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
const noDrizzleTransaction = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid calling drizzle\'s transaction outside the Postgres transact.',
    },
    schema: [],
    messages: {
      direct: 'use transact(db, body) from src/data/active.ts',
    },
  },
  create(context) {
    if (!covers(repoPathOf(context.cwd, context.filename))) {
      return {};
    }
    return {
      /** @param {import('estree').CallExpression} node */
      CallExpression(node) {
        if (isTransactionMember(node.callee)) {
          context.report({ node, messageId: 'direct' });
        }
      },
    };
  },
};

export default noDrizzleTransaction;
