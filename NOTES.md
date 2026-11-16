Data Tooling - Coding Assignment

## Time budget tracking:
- Start: ~9:45AM
- Directory and project bootstrapping: 5 minutes
- Going through requirements, doing inventory of the open-tomato package status, and writing down requirements notes: 30~35min
- Setting up dependencies and running a blank service: 

Requirements:
- Service exposing at least 2 resources (companies and filings) to provide listings of companies submissions and a summary. 
  - Use: `@open-tomato/service*` via the shell implementation `@open-tomato/template-service` to bootstrap the work directory quickly 
  - Additional endpoints from the expressed in the requirements will include a `[GET]` returning all known companies for easy switching.
  - format of the resource URIs (draft): 
    - `[GET] /companies/{:ticker}/filings`: Paginated, filterable.
    - `[GET] /filings/summary`: expects an array of companies. 
    - `[GET] /companies`: optional, returns all companies to simplify company switching on the client.
    - `[GET] /companies/{:ticker}` or `[POST] /search/`: Proposed, search first against cached company list or validation of criteria before hitting SEC services.
  - To check and define:
    - Can the documents be fetched directly or do I need to handle a special method to download and caching on our end first?
    - Do I require validation on any of the SEC resources?
    - DB: initial thought is that it doesn't seem to be required, but I still need to look into the SEC data, SQLite is already available in bun and won't be an issue, but I'd use drizzle for migrations if data gets complex so moving to something like pg won't be too much of a rework.  
- Front end:
  - Simple datagrid with handful of controls, how they pick and switch between companies is not defined explicitly. 
    - For results control: implement `Toolbar` it has all the requirements and a bit more.
    - For datagrid use `Table`
  - For company switching I'll use either:
    - `ContextSwitcher` with known companies on top of the sidebar.
    - A new view with a grid with `RowStatCards` and include some of the available data in there already.
    - Top bar `CommandPallette`, if it's flexible enough to be reused to search against SEC or a pre-set of companies, fallback to simple `Select` otherwise.
  - Summary: Pending to see what data is available, but I can leverage several visualization components from `@open-tomato/charts`
  - To check and define:
    - Include the app shell or leave the views as a single screen with the listings, the company selector on top and the documents show on a `Modal` or a `Drawer`. Decision: Leave the appShell, it's a bit above the top for the test requirement but it's already done and it doesn't differ of something that a prompt will do in a bit, except is already done and tested, slightly more reliable I guess.
    - If there's time, add the search company page with the `RowSelector` component to turn which companies to follow, these will show up in the company switching selector. q: Would make sense if UX wise this action might already trigger an ingest into the cache for their fillings?

- Extras included in the template:
  - `@open-tomato/service-mcp` uses the same handlers and schemas as the ones used for the APIs so setting it up is very cheap. 
  - Open Notebook support. 
    - The MCP service has the Open Notebook driver defined already so wiring it to a notebook instance (can run on a docker) would be couple of lines and I will get it for free basically.
    - If document handling and caching becomes an issue, the notebook could be serve as storage, not ideal, but it will do the trick right out of the box and provide additional insights and search functionality. 

check [10:35]. Done with planning and bootstrapping, starting with some surveying. 
- Data extraction first pass (human):
  - given example: `data.sec.gov/submissions/CIK##########.json`
  - Get tech summary translation from legal framing of automated data extraction [here](https://www.sec.gov/about/privacy-information) 
  - cik is the raw CIK, cik10 will be the cik with leading `0`s up to 10 digits, both formats are used. Use the json list with companies for seeding the company list. 
  - archve: https://www.sec.gov/Archives/edgar/data/$cik/index.json
  - navigation pattern:
  - company data:
  - fillings: https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/AccountsPayableCurrent.json
  ```
        {
        "end": "2009-01-25",
        "val": 218864000,
        "accn": "0001045810-09-000024",
        "fy": 2009,
        "fp": "Q2",
        "form": "10-Q",
        "filed": "2009-08-20"
      },
    ```
  - company archive  https://www.sec.gov/Archives/edgar/data/1045810/000104581026000024/ => xml(`FilingSummary.MyReports.InputFiles[doctype='8-K']` = `nvda-20260302.htm`)
Check [11.37]. -- done reviewing data structures and api and first query trials
[!note] `@open-tomato/ui` was using our local private registry, ensure the last published version is updated in https://registry.npmjs.org/ after the credentials rotation. 
Check [~15.00] -- resuming work reviewing previous findings. Now building spec -> plan -> `rafa loop start`
- Findings:
  - Ticker to CIK matching fail on seconday checks as some companies have multiple tickers, so the schema was split in a ticker mapping table against the company CIK, same behaviour on the api, the handling is internal.
Check [~15.30] -- the setup session went off script. Instead of stopping at the spec, it wrote its own plan and started executing it, attempting a rebase of the original `template-service` into this project commit by commit. It left a non working branch, a half baked plan and modified context files. I stopped it and fixed the changes before running the loop.
- Postmortem. Log of events:
  1. After doing the manual research, checking the schemas, downloading sample files from the SEC and trying a few api and document fetches, I updated and cleaned up this file with all the context I had.
  2. I started a claude session in VSC in `/plan` mode (blue prompt box checked) with @schema-survey-review.md as the first prompt: look into this file, check the schemas and files, and propose code snippets and data structures.
  3. I picked, reviewed and cleaned up the code and updated the @setup-prompt.md context file.
  4. I iterated once more so the prompt only produced a spec, to create a plan with `rafa plan create` and run it manually. That was said both in the prompt and in setup-prompt.md.
  5. Instead of writing the spec at the end of the task, it wrote its own plan and started executing it without rafa's tooling or context, cherry picking commit by commit from the sibling repo.
  6. I stopped it, made it clean up and fix the broken state.
  7. Rebased the service repo properly (template merge `bf1dff6`).
  8. Updated this file.

Check [~16.10] -- second pass, in a fresh session from the rafa repo: spec -> plan -> loop the proper way, with rafa's CLI.
- CLI sequence for a project with no issue board (spec file, branch `main`, specs and plans tracked in `docs/`):
  - `rafa init --yes --no-board --no-release`: writes `.rafa/config.yaml`, the `.rafa/` folders and the rafa block in `.gitignore`.
  - `rafa config set plan.dir=docs/plans && rafa config set specs.dir=docs/specs`: rafa's defaults are `.rafa/plans` and `.rafa/specs`, which `.gitignore` hides; `docs/` is tracked like any other file.
  - `rafa plan create --spec=docs/specs/<spec>.md`, then `rafa loop start --plan=docs/plans/PLAN-<spec>.md --create-branch`.
- Before planning, I had it check `docs/specs/` and the root context files against rafa's spec norm. Everything below would have turned the gates red, or sent the loop sideways:
  - The docs checks, the eslint ignores and the spec still said `docs/plan/`, but rafa writes to `docs/plans/`. The plan would have been read as a normal page and failed the paths and quoted-code tests.
  - rafa writes one task per plan line, up to 665 chars (measured on rafa's own plans), and the width test caps at 100.
  - `schema survey review.md` (with spaces) was referenced everywhere, but the file is `schema-survey-review.md`.
  - The spec's "Current state" was stale (setup branch already merged, `bun install` already done), and phase 0 step 4 (copy the plan into docs) was obsolete.
  - The spec wasn't on rafa's template: six headings, no "What can go wrong", and definition-of-done items that no command can show.
  - The loop commits with `git add -A`, so anything I write here mid loop would end up in a task commit -> `git update-index --skip-worktree NOTES.md` for the run.
  - CLAUDE.md told every session to run `rafa describe --output=json` (~240 KB). Every loop task is a "first time", so each one would read it.
Check [~16.37] -- fixes, straight to `main`:
  - `dca3514`: the docs checks read `docs/plans/` and `schema-survey-review.md`, and `docs/plans/` is exempt from the width check. Probed with a fake 300 char plan: passes in `docs/plans/`, fails in the old `docs/plan/`.
  - `6e0dfa1`: `bun run privacy` failed on `.env`. The text rules only read tracked files, but gitleaks got the whole folder (`.env`, `.git/`, the gigabytes in `.tmp/`). Now gitleaks scans a temp copy of the tracked files only. Test first (red), then the fix. The same gap is upstream in `template-service`.
  - `e8050ed`: spec moved to rafa's template.
  - `ce15ada`: CLAUDE.md, loop sessions learn commands from `--help` and never run `rafa describe`.
Check [~16.43] -- `rafa plan create --spec=docs/specs/sec-filings.md` -> 9 stages, 56 tasks. The planner's review read the spec as `ready`, with 7 non blocking gaps, each with the assumption it planned under (sec client in `src/sec/`, PATCH keeps the selection when SEC fails, 94 rows of every form with 13 in the tracked ones). Committed `7c082fa` and pushed, after a privacy scan of the history.
Check [~16.59] -- `@open-tomato/charts` was missing (Summary page) and the dependency gate hook blocked `bun add`. Updated the hook: `bun install` and `bun add @open-tomato/*` (when not already in package.json) pass, `bunx` / `bun x` still ask first. `822e3c5`.
Check [~17.33] -- 3 server tests red locally. At first it looked like `DATABASE_URL`, because the error names it. It was `AUTH_MODE=password` from `.env` (written by `set-password`) leaking into the tests, so the API key refusal never fired. The tests now clear `AUTH_MODE`. `4973e74`, 994 pass / 0 fail.
  - Side note: `DATABASE_URL=sqlite://...` is not valid. Only `file:<path>`, `:memory:`, or unset (-> `./data/app.db`).
- `SEC_USER_AGENT` added to `.env`. It's not auth and the records are public, but SEC blocks scripts that don't identify themselves: measured 403 with no UA, 403 with curl's default, 200 with `name email`. Browsers work because they send their own UA.
Check [~17.xx] -- `rafa doctor --plan=docs/plans/PLAN-sec-filings.md` green, no loops running, `main` clean. Started the loop by hand: `rafa loop start --plan=docs/plans/PLAN-sec-filings.md --create-branch`.
- After the merge: `git update-index --no-skip-worktree NOTES.md`, then commit this file.
- Takeaways:
  - The spec prompt also listed deliverables (README, copies of the spec and plan), which probably made it read as a work order. Next time the spec prompt asks for the spec only, and setup goes through the tool that owns it.
  - Check the spec and the context files against the tool's norm before planning: most of the red gates here were naming drift between files written at different times.