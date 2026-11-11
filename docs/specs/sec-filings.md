# SEC filings service

## Goal

List US companies from the SEC ticker file, fetch each company's last year of filings from EDGAR
on demand, store them, and link every filing to its original document on sec.gov. A Companies
page picks which companies to follow, and a Summary page compares them. Documents are linked,
never downloaded.

## Source of truth

- `setup-prompt.md` holds every schema, snippet, link template and edge case. Each task names the
  `setup-prompt.md` section it uses, in quotes.
- `CLAUDE.md` holds the backend layout (route, flow, contract, repository, table, tool), the
  logging rules and the gates.
- `.claude/skills/` holds the scaffolding skills: `/be create-route`, `/db add`, `/db migrate`,
  `/fe empty-page`. Use them instead of writing the scaffolding by hand.

## Current state (2026-11-11)

Branch `chore/setup-sec-filings`, cut from `main` after the bootstrap commit `534a7d3`.

Done:

- **Schema survey.** The EDGAR submissions document, the ticker file and the link templates were
  read from real data, and the links were checked live (HTTP 200 for the document, index, folder
  JSON, ix viewer, raw XML and overflow URLs). The results are in `setup-prompt.md`.
- **`setup-prompt.md`** is updated for the decisions below and wrapped to the docs width.
- **Phase 0, steps 1 to 3** (template update, docs checks, README). The template merge is commit
  `2f3d64c`; the docs checks, ESLint ignores and README are in the commit that adds this spec.
- **Prompt records.** `schema survey review.md` and `setup-prompt-review.md` hold the two prompts
  that produced this spec.

Decisions already taken, so tasks do not reopen them:

- Companies are stored by CIK, with a `company_tickers` table mapping each ticker to its CIK,
  because the ticker file has 10,414 tickers for 8,009 CIKs (`AEM` and `AEMRF` are one company).
- Only the last year of filings is stored; overflow files are never fetched.
- The filter is three forms (`10-K`, `10-Q`, `8-K`), matched on the base form, so amendments
  (`10-K/A`) count under their form with `isAmendment: true`. There is no category map.
- `PATCH /companies/:ticker` takes a required `selected` boolean, not a toggle, so a retried
  request does not undo itself.
- `GET /companies` takes `q`, because 8,009 companies are paged on the server and the search
  has to run there.

Open:

- **`bun install` has not run**, so the three packages the template merge added
  (`@asteasolutions/zod-to-openapi`, `swagger-ui-dist`, `typedoc`) are missing. Until it runs,
  `bun run typecheck` and `bun run lint` fail on `src/http/openapi.ts`, and 12 test files fail to
  load for the same import. All other tests pass (886), and the docs tests pass in full.
- Phase 0, step 4 (copy the rafa plan) waits for `rafa plan create`.
- Phases 1 to 7 have not started.

## Prerequisites (the user runs these, no task does)

1. `bun install`, after phase 0 brings the template's `package.json` in. Tasks never install.
2. `bun run set-password` once. It is interactive: it asks for the password twice and writes
   `AUTH_MODE=password` and `AUTH_PASSWORD_HASH` into `.env`.
3. `SEC_USER_AGENT="<app name> <contact email>"` in `.env`, before phase 3's live probe.
4. `gitleaks` on `PATH` for `bun run privacy`; otherwise the gate runs with `-- --no-gitleaks`.

## Out of scope

- Overflow history files (`filings.files[]`): only the last year is kept.
- Downloading or caching documents.
- Visual or screenshot tests. Web checks are render tests in `tests/web/pages.test.tsx`.
- Any package or tool for API docs. The template's `src/http/openapi.ts` builds the OpenAPI
  document from the route table, and `bun run docs:generate` exports it with TypeDoc.
- Changes to `NOTES.md`. It is the assessment's hand-written log; no task edits, moves or
  reformats it.

## Rules for every phase

- Each phase ends with the gates, in order: `bun run lint`, `bun run typecheck`,
  `bun run typecheck:pg`, `bun test`, `bun run privacy`.
- Before each commit, sweep the staged diff for private data: home-directory paths, local user
  names (GitHub logins and the `open-tomato` org are allowed), email addresses, host and device
  names, private registry URLs, `.env` contents, keys, tokens and password hashes. `.env`,
  `data/`, `.tmp/`, `.rafa/` and `.DS_Store` are never committed. A hit stops the commit and is
  reported, not rewritten silently.
- `NOTES.md` is never staged by a task.
- Seed and fixture data are copies of public SEC files. They still go through the sweep.

## Phase 0: Project setup

The template moved on after this project was made, and the docs checks were written for template
pages, not for planning documents. This phase lines both up before any feature work. Steps 1 to
3 are done (see "Current state"); a task checks that each one's result is in the tree and skips
it.

1. **Template update.** Bring the latest `open-tomato/template-service` `main` in, following
   `docs/template-updates.md` (first merge needs `--allow-unrelated-histories`). It brings
   `src/http/openapi.ts`, `src/http/docs.ts`, `scripts/export-openapi.ts` and the `docs:*`
   scripts. Conflicts on files this project never changed take the template's side. Skip this
   step when `git log` already shows the merge.
2. **Docs checks for planning documents.** A planning document names files its work has yet to
   create, so:
   - `tests/docs/markdown.ts` exports `isPlanningDoc(file)`: `setup-prompt.md`,
     `setup-prompt-review.md`, `schema survey review.md`, `docs/specs/**.md`,
     `docs/plan/**.md`. Tested in `tests/docs/markdown.test.ts`, both ways.
   - `tests/docs/paths.test.ts` and `tests/docs/quoted-code.test.ts` skip planning documents.
     The width and link checks still read them.
   - `tests/docs/width.test.ts` skips `NOTES.md` (a `WIDTH_EXEMPT` set with its reason).
   - `eslint.config.mjs` ignores `NOTES.md` and the planning documents, because their fences
     sketch code that does not compile on its own.
3. **README.** Rewrite `README.md` for this project: what it is; prerequisites; setup and first
   run (`bun install`, `cp .env.example .env`, `bun run set-password`, `SEC_USER_AGENT`,
   `bun run db:migrate`, `bun run db:seed`, `bun run serve`, sign in at `/login`); how the
   password is stored (hash only) and recovered (`bun run reset-credentials`, then
   `set-password`); the optional API key (`bun run setApiKey --burn-after-reading`); that the DB
   file is created by `db:migrate`, not by `serve`; the API docs at `/api/docs` and
   `/api/openapi.json`; the gates; links to this spec, `docs/plan/` and every `docs/*.md` page
   (the indexes test requires them).
4. **Plan copy.** Copy `.rafa/plans/PLAN-sec-filings.md` to `docs/plan/sec-filings.md`, so the
   plan is tracked in git while `.rafa/` stays ignored, and link it from the README's "Read
   next" list.
5. Done when: the gates pass, apart from what `bun install` still has to bring (the prerequisite
   above).

## Phase 1: Endpoints and contracts

1. Add `PaginationQuery`, `pageOf`, `Ticker`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX` to
   `src/routes/common.ts` ("Shared route schemas"). `Ticker` accepts lower case and returns
   upper case.
2. Add the entities `Company`, `CompanyTicker`, `Filing`, `FilingLinks`, `TrackedForm` and
   `toCik10` under `src/entities/` ("Data normalization"). Entities import only zod and other
   entities (`template/layer-imports`).
3. `/be create-route companies` with `list` (`GET /companies`) and `update`
   (`PATCH /companies/:ticker`), and `/be create-route filings` with `list`
   (`GET /companies/:ticker/filings`) and `summary` (`GET /filings/summary`). Contracts from
   "Endpoint contracts". Each route has its MCP tool (`company_list`, `company_update`,
   `filing_list`, `filing_summary`). Flows return fixed stub data through injected deps.
4. Every route passes a `summary` to `route()`, so the OpenAPI document describes it.
5. Tests:
   - Each input schema refuses a malformed ticker, an unknown form, `page: 0`, `pageSize: 101`,
     a stray field, and a PATCH without `selected`.
   - Each stub response passes its output schema.
   - `tests/http/openapi.test.ts` (extended): the document lists the four routes with their
     path, query and body fields, and the `{ success: true, data }` 200 envelope.
   - Every exported contract and flow has TSDoc, and `bun run docs:typedoc` runs with no
     warnings.

## Phase 2: Database and seed

1. `/db add companies`, `/db add company_tickers`, `/db add filings` with the columns and
   indexes in "DB tables", both dialects, one migration each, generated and committed.
2. Copy `.tmp/company_tickers.json` to `src/data/seeds/data/company_tickers.json` (`.tmp/` is
   gitignored, so the seed cannot read it there).
3. Write `src/data/seeds/01-companies.ts` ("Seed"): one company per CIK, the first ticker in the
   file as the primary, every ticker in `company_tickers`, chunks of 500,
   `onConflictDoNothing`.
4. Repositories `src/data/repositories/companies.ts` and `filings.ts`: list companies (by name,
   `q` as ticker prefix or name contains, `selected`, page and total), resolve a ticker to its
   company, set `selected`, update the header fields after a sync, insert filings, delete a
   company's filings before a cutoff, page filings (base form filter, sort), summary counts and
   latest 10-K per selected company.
5. Wire the phase 1 flows to the repositories, except the SEC sync, which phase 3 adds.
6. Tests:
   - Seeding twice leaves 8,009 companies and 10,414 tickers.
   - `AEM` and `AEMRF` resolve to CIK 2809; an unknown ticker is a 404.
   - The list is alphabetical; the page past the last returns `items: []` with the real total.
   - `PATCH` with `selected: true` twice leaves the company selected (no toggle).

## Phase 3: SEC fetching

1. `SEC_USER_AGENT`: read and validated at startup, and the service refuses to start without
   it. Add it to `.env.example` commented out with a placeholder contact, and to the
   configuration table in `docs/setup.md` (the env test requires both).
2. An SEC client over an injected `fetch`: sets the User-Agent, keeps to 10 requests per second
   or fewer, maps 403, 404, 429 and network errors to typed errors.
3. Parsing ("Code snippets / parsing algorithms"): `SubmissionsHeader` (loose), `columnsToRows`,
   `withinRetention`, `splitForm`, `toFiling`, `buildLinks`.
4. The sync flow per "Ingest flow", with `SYNC_TTL_HOURS = 24` and `RETENTION_DAYS = 365`:
   `GET /companies/:ticker/filings` syncs when the data is stale; `PATCH` with
   `selected: true` syncs before it answers; the summary never calls SEC.
5. Tests with a stub `fetch`:
   - A second request within the TTL makes no SEC call.
   - A 403 answers 502; with stale rows present, they are served instead.
   - Rows older than the cutoff are deleted on sync.
   - The request carries the `SEC_USER_AGENT` value.

## Phase 4: Response and link validation

1. Copy `.tmp/APPL-CIK0000320193.json` to `tests/fixtures/sec/aapl-submissions.json`, and cut a
   5-row fixture from it (10-K, 8-K, Form 4, 424B2, UPLOAD).
2. Contract test ("DoD verification"): the 1001 rows parse with 0 failures; with
   `now = 2026-11-11`, the last-year cut keeps 94 rows: 1 × 10-K, 3 × 10-Q, 9 × 8-K.
3. Unit tests for every case in "Edge cases for test suite".
4. Live probe, off unless `SEC_LIVE=1`: `HEAD` the document, index and ix viewer links built for
   Apple's 10-K `0000320193-26-000026`, and expect 200 for each. A skipped probe reports as
   skipped, not as passed.

## Phase 5: Companies page

1. `/fe empty-page companies`.
2. `Toolbar` with search (`q`, debounced) and a selected-only filter, plus pagination controls.
3. One `RowStatCard` per company (stats-only story): the name as a `ghost` `Button` that opens
   the filings view; a `Switch` on the right that calls `PATCH selected`. If `RowStatCard`
   cannot hold a `Switch`, try `DecoratedToggle`, then `OptionCard`, then a `Table` with a
   toggle column; record which one was used in the commit body.
4. Render tests: rows render from the API stub; the switch sends the PATCH with an explicit
   boolean; an API error shows a message, not an empty list.

## Phase 6: Filings view

1. A `Drawer` (option B) and a full-screen `Modal` (option A), behind one toggle, both fed by
   `GET /companies/:ticker/filings`.
2. Top: an `EntityCard` titled `Latest: 10-K <date>` that opens `links.document`.
3. Drawer body: `Accordion` first (variant 1), one group per form; each child shows the filing
   date and `primaryDocument`, links to `links.document`, and adds the ix viewer link when
   present. `TreeNav` (variant 2) only if `Accordion` cannot hold the links.
4. Modal body: a 3-column grid, one `SectionCard` per form.
5. Render tests: groups match the three forms; links carry the built URLs; a company with no
   10-K shows no latest card.

## Phase 7: Summary page

1. `/fe empty-page summary`.
2. Three compact `SmallStatCard`: total filings of the selected companies, average per company,
   latest filing.
3. `Table`: ticker `Badge`; the name as a `ghost` `Button` that opens the filings view; one
   column per form; a Remove button behind `ConfirmPopover` that sends `PATCH selected: false`.
4. Stacked bar chart from `@open-tomato/charts`: filings per company, one stack per form.
5. Render tests: the table lists the selected companies; Remove asks first and then sends the
   PATCH; an empty selection shows a pointer to the Companies page.

## Done when

- Every phase's gates pass.
- On a fresh clone, the prerequisites plus the README's setup steps start the service with the
  seeded companies, and selecting Apple shows its last year of filings with working links.
- No commit holds private data (the sweep in "Rules for every phase").
