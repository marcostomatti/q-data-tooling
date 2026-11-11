/**
 * A PostToolUse hook: after an Edit or a Write, it runs `eslint --fix` on that one file, so the
 * rules ESLint can repair by itself (semicolons, line breaks before a chained call, import
 * order) are fixed while the file is written, by whoever edits it: a person's session or a
 * loop's task session.
 *
 * It never blocks and prints nothing. An error `--fix` cannot repair stays in the file for
 * `bun run lint` to report. A failure of the hook itself (no input, an unparsable payload, a
 * path outside the project, a file type ESLint does not read) ends it quietly, because a
 * formatting pass must never stop an edit.
 *
 * The switch is per repository: `.claude/settings.json` registers it, and a repository that does
 * not want it leaves it out.
 */
import { extname, isAbsolute, relative, resolve } from 'node:path';

/** The file types the ESLint config reads: code, JSON and Markdown with its fences. */
const LINTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.md',
]);

interface HookInput {
  readonly tool_input?: { readonly file_path?: unknown };
}

function readTarget(payload: string, root: string): string | undefined {
  let input: HookInput;
  try {
    input = JSON.parse(payload) as HookInput;
  } catch {
    return undefined;
  }
  const raw = input.tool_input?.file_path;
  if (typeof raw !== 'string' || raw === '') return undefined;
  const file = resolve(root, raw);
  const inside = relative(root, file);
  if (inside.startsWith('..') || isAbsolute(inside)) return undefined;
  return LINTED_EXTENSIONS.has(extname(file)) ? file : undefined;
}

const root = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
const target = readTarget(await Bun.stdin.text(), root);
if (target !== undefined) {
  const eslint = Bun.spawn(['bunx', 'eslint', '--fix', '--no-warn-ignored', target], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await eslint.exited;
}
