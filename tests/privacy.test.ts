import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const REPO_ROOT = join(import.meta.dir, '..');

/**
 * Whether a denylist is named. The script reads `PRIVACY_DENYLIST` itself; the test reads it only
 * to name what it checked, so a run without the denylist never reads as a whole one.
 */
const WITH_DENYLIST = (process.env.PRIVACY_DENYLIST ?? '') !== '';

const TITLE = WITH_DENYLIST
  ? 'no tracked file matches the generic rules or the denylist'
  : 'no tracked file matches the generic rules (no denylist set)';

/**
 * The scan `bun run privacy` runs, `bun scripts/privacy-check.ts .`, without gitleaks, which a
 * test cannot assume is installed. Its output names each finding as `file:line rule`, never the
 * text that matched, so the failure message can be shown as it is.
 */
function privacyScan(): { exitCode: number; lines: readonly string[] } {
  const run = Bun.spawnSync(['bun', 'scripts/privacy-check.ts', '.', '--no-gitleaks'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = `${run.stdout.toString()}${run.stderr.toString()}`;
  return { exitCode: run.exitCode, lines: output.split('\n').filter(Boolean) };
}

describe('the privacy scan', () => {
  test(TITLE, () => {
    const { exitCode, lines } = privacyScan();
    const summary = WITH_DENYLIST
      ? '0 finding(s)'
      : '0 finding(s) (no denylist)';
    expect(lines).toEqual([summary, 'gitleaks did not run']);
    expect(exitCode).toBe(0);
  });
});
