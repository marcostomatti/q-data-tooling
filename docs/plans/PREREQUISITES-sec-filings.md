# Prerequisites

For [PLAN-sec-filings.md](PLAN-sec-filings.md).

## Before the loop [human]

- [ ] Run bun run set-password once (interactive); it writes AUTH_MODE=password and
  AUTH_PASSWORD_HASH into .env.
- [ ] Install the chart library the Summary page needs: bun add @open-tomato/charts. Commit
  package.json and bun.lock yourself, so the change does not ride into a task commit.
- [ ] Mark NOTES.md skip-worktree before starting the loop: git update-index --skip-worktree NOTES.md
- [ ] Put gitleaks on PATH for bun run privacy; without it the gates run with -- --no-gitleaks.

## Toolchain and data [auto]

- [ ] NOTES.md is marked skip-worktree, so no task commit sweeps it in: `git ls-files -v NOTES.md | grep -q '^S'`
- [ ] SEC_USER_AGENT is set in .env as an app name and a contact email: `grep -q '^SEC_USER_AGENT=' .env`
- [ ] [tasks] The chart library is installed: `test -d node_modules/@open-tomato/charts`
- [ ] [tasks] The SEC ticker file is in the scratch folder: `test -f .tmp/company_tickers.json`
- [ ] [tasks] The Apple submissions file is in the scratch folder: `test -f .tmp/APPL-CIK0000320193.json`

## Operator steps after the plan merges [human]

- [ ] Clear the skip-worktree mark on NOTES.md: git update-index --no-skip-worktree NOTES.md
