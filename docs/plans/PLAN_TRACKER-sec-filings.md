# Plan: SEC filings service

```rafa:plan
stub: sec-filings
spec: docs/specs/sec-filings.md
release: minor
```

```rafa:context
The project is a service made from `open-tomato/template-service`. `CLAUDE.md` holds the backend
map (route, flow, contract, repository, table, tool), the logging rules and the gates.
`setup-prompt.md` holds every schema, snippet, link template and edge case; each task names the
section it uses, in quotes, and that section is the source of truth for names and shapes.
Scaffold with the project skills under `.claude/skills/` (`/be create-route`, `/db add`,
`/db migrate`, `/fe empty-page`) instead of writing the scaffolding by hand.

Rules for every task:
- Tasks never install packages. A missing package is reported in the task's report, not added.
- Before the task commits, sweep the staged diff for private data: home-directory paths, local
  user names (GitHub logins and the `open-tomato` org are allowed), email addresses, host and
  device names, private registry URLs, `.env` contents, keys, tokens and password hashes. A hit
  stops the task as blocked and is reported, never rewritten silently.
- `.env`, `data/`, `.tmp/`, `.rafa/`, `.DS_Store` and `NOTES.md` are never staged or edited.
- Of `.tmp/`, a task reads only the one file it names. The folder holds gigabytes of SEC files,
  so no task lists or searches it.
- Seed and fixture data are copies of public SEC files and still go through the sweep.
- Every exported symbol gets TSDoc (`@param`, `@returns`, `@throws` on functions).
- Flows import no transport and nothing under `src/data`; entities import only zod and other
  entities (`template/layer-imports`). Lint reports a break on the exact import.
- Decisions not to reopen: companies are keyed by CIK with a `company_tickers` table; only the
  last year of filings is stored and overflow files are never fetched; the filter is the base
  form of `10-K`, `10-Q`, `8-K` with amendments counted under their form and
  `isAmendment: true`; `PATCH /companies/:ticker` takes a required `selected` boolean, never a
  toggle; `GET /companies` takes `q` and pages on the server.
```

## Description

The service lists US companies from the SEC ticker file, fetches each followed company's last
year of filings from EDGAR on demand, stores them, and links every filing to its original
document on sec.gov. A Companies page picks which companies to follow; a Summary page compares
them. Documents are linked, never downloaded.

Phase 0 steps 1 to 3 (template merge `2f3d64c`, the planning-doc checks, the README rewrite) are
already in the tree; the first task confirms each and changes nothing when it holds. Every
stage maps to one phase of the spec and ends with a gates task: `bun run lint`,
`bun run typecheck`, `bun run typecheck:pg` and `bun run privacy` (with `-- --no-gitleaks` when
gitleaks is not on `PATH`), with `bun test` run by the loop's runner through `tests=full`.

Placement decisions the spec leaves open, taken here so tasks do not each pick one:
- The SEC client and the submissions parsers live under `src/sec/` (`client.ts`, `parse.ts`),
  and reach flows only through injected `deps`. The sync flow is
  `src/routes/filings/sync.flow.ts`.
- `SYNC_TTL_HOURS = 24` and `RETENTION_DAYS = 365` are exported constants of the sync flow, and
  every time-dependent function takes `now` as a parameter.
- `PATCH /companies/:ticker` with `selected: true` stores the selection first, then runs the
  sync under the same failure rule as the filings list: on an SEC failure it answers 502 when the
  company has no stored rows, and answers the company otherwise. The selection stays set either
  way.
- The Companies page's name button calls an `onOpenFilings(ticker)` prop; the filings view built
  in the Filings stage is wired to it there.
- The component chosen for a company row (`RowStatCard`, `DecoratedToggle`, `OptionCard` or a
  `Table`) is named in that task's report feedback and in the page module's TSDoc, since the
  loop writes the commit.

Setup the operator does before the loop, including installing `@open-tomato/charts` and
marking `NOTES.md` skip-worktree, is in [PREREQUISITES-sec-filings.md](PREREQUISITES-sec-filings.md).

# Stage: Project setup

- [x] Confirm the template merge `2f3d64c` is in `git log`, `isPlanningDoc` and its two-way tests are in `tests/docs/markdown.ts` and `tests/docs/markdown.test.ts`, `WIDTH_EXEMPT` and `WIDTH_EXEMPT_DIRS` are in `tests/docs/width.test.ts`, the planning-doc ignores are in `eslint.config.mjs`, and `README.md` holds the setup, password, API key, API docs and gates sections, reporting any that is missing as a blocker  {tools=Read,Grep,Glob,Bash model=haiku effort=low}
  - close-out: merge 2f3d64c present in git log; isPlanningDoc and its two tests present; WIDTH_EXEMPT and WIDTH_EXEMPT_DIRS present; planning-doc ignores present in eslint.config.mjs; README has setup, password, API key, API docs and gates content (password and API key are bullets under "Setup and first run", no separate headings). No blockers. tests/docs markdown and width: 35 pass.
- [x] Add `docs/plans/PLAN-sec-filings.md` to the "Read next" list of `README.md`  {agent=doc-updater effort=low}
- [x] Run the project setup gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Endpoints and contracts

```rafa:stage-context
Contracts come from "Shared route schemas", "Data normalization" and "Endpoint contracts" in
`setup-prompt.md`. Flows in this stage return fixed stub data through injected `deps`; the
Database and seed stage wires them to repositories. Every `route()` call passes a `summary` so
`buildOpenApiDocument` in `src/http/openapi.ts` describes it. The four MCP tools are
`company_list`, `company_update`, `filing_list` and `filing_summary`, each listed in `ALL_TOOLS`
in `src/routes/tools.ts`, and each route in `ROUTES` in `src/routes/http.ts`.
```

- [x] Add `PaginationQuery`, `pageOf`, `Ticker`, `PAGE_SIZE_DEFAULT` and `PAGE_SIZE_MAX` to `src/routes/common.ts` per "Shared route schemas", with unit tests showing `Ticker` accepts lower case and returns upper case  {agent=loop-implementer effort=medium tests=module}
  - Note: the tests are in `tests/routes/common.test.ts` (10 pass). A control run without `.toUpperCase()` made 2 Ticker tests fail.
- [x] Add the entities `Company`, `CompanyTicker`, `Filing`, `FilingLinks`, `TrackedForm` and `toCik10` under `src/entities/` per "Data normalization", with their unit tests  {agent=loop-implementer effort=medium tests=module}
  - Note: `src/entities/company.ts` and `src/entities/filing.ts`; tests in `tests/entities/` (21 pass). A control run without `.strict()` and with `padStart(9)` failed 3 tests.
- [x] Scaffold `src/routes/companies/` with `/be create-route companies`: `list` (`GET /companies`) and `update` (`PATCH /companies/:ticker`) with the "Endpoint contracts" schemas, stub flows, a `summary` on each route, and the `company_list` and `company_update` tools  {agent=loop-implementer effort=high skills=be tests=module}
  - Note: `src/routes/companies/` holds the contract, `list.flow.ts`, `update.flow.ts`, `stub.ts` (the fixed store the next stage swaps for a repository), `http.ts` and `tool.ts`; tests in `tests/routes/companies/` (27 pass). A control run with the stub flipping `selected` failed 2 tests.
- [x] Scaffold `src/routes/filings/` with `/be create-route filings`: `list` (`GET /companies/:ticker/filings`) and `summary` (`GET /filings/summary`) with the "Endpoint contracts" schemas, stub flows, a `summary` on each route, and the `filing_list` and `filing_summary` tools  {agent=loop-implementer effort=high skills=be tests=module}
  - Note: `src/routes/filings/` holds the contract, `list.flow.ts`, `summary.flow.ts`, `stub.ts` (a companies lookup and a filings store over one public Apple 10-K), `http.ts` and `tool.ts`; tests in `tests/routes/filings/` (37 pass). Control runs failed 5 tests (wrong offset, form filter off) and 11 (`filingRoutes` left out of `ROUTES`). Open: the summary's `form` is read by the stub as "keep the companies with a filing of that form"; the filings repository task settles it.
- [x] Add input-schema tests refusing a malformed ticker, an unknown form, `page: 0`, `pageSize: 101`, a stray field, and a `PATCH` body without `selected`, for every input schema of the companies and filings contracts  {agent=tdd-guide effort=medium}
- [x] Add tests showing each stub flow response of the companies and filings routes and tools passes its output schema  {agent=tdd-guide effort=medium}
- [x] Extend `tests/http/openapi.test.ts` to hold that the OpenAPI document lists the four routes with their path, query and body fields and the `{ success: true, data }` 200 envelope  {agent=tdd-guide effort=medium tests=module}
- [x] Bring `bun run docs:typedoc` to zero warnings over the new contracts, flows, entities and shared schemas by completing their TSDoc  {agent=loop-implementer effort=low skills=documentation}
  Note: plain `docs:typedoc` already had 0 warnings (notDocumented is off by default). Under `--validation.notDocumented` the in-scope count fell from 128 to 17; those 17 are zod `z.enum` key maps, which a source comment cannot document.
- [x] Run the endpoints-and-contracts gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Database and seed

```rafa:stage-context
Columns and indexes come from "DB tables" in `setup-prompt.md`; the seed from "Seed". `/db add`
writes the table in both `src/data/sqlite/tables/` and `src/data/pg/tables/` and one generated
migration per dialect; commit the generated files with the schema. The seed runner
`src/data/seed.ts` runs `src/data/seeds/<NN>-<name>.ts` files in a transaction each and on every
`db:seed`, so the seed must be idempotent. The SEC sync is not part of this stage: the filings
list reads stored rows only until the SEC fetching stage adds the sync.
```

- [ ] Add the `companies` table with `/db add companies` per "DB tables", both dialects, with its generated drizzle migrations  {agent=loop-implementer effort=medium skills=db tests=module}
  - Note: `companies` lives in `src/data/<dialect>/tables/companies.ts`; `company_tickers` belongs in the same file. Migrations `0001_add-companies` in both `drizzle/` folders. `db:migrate` was not run against `data/` (the plan forbids editing it); the migrated `:memory:` tests apply it instead.
- [ ] Add the `company_tickers` table with `/db add company_tickers` per "DB tables", both dialects, with its generated drizzle migrations  {agent=loop-implementer effort=medium skills=db tests=module}
- [ ] Add the `filings` table with `/db add filings` per "DB tables", including the `(cik, filing_date DESC)` and `(cik, base_form)` indexes, both dialects, with its generated drizzle migrations  {agent=loop-implementer effort=medium skills=db tests=module}
- [ ] Copy `.tmp/company_tickers.json` to `src/data/seeds/data/company_tickers.json`, reading no other file under `.tmp/`  {tools=Read,Bash model=haiku effort=low}
- [ ] Add the seed `src/data/seeds/01-companies.ts` per "Seed": validate with `TickerFile`, one company per CIK with the first ticker as primary, every ticker in `company_tickers`, chunks of 500 with `onConflictDoNothing`, with unit tests over a small inline ticker list  {agent=loop-implementer effort=high skills=db}
- [ ] Add the companies repository `src/data/repositories/companies.ts`: list by name with `q` as ticker prefix or name contains, `selected`, page and total; resolve a ticker to its company; set `selected`; update the header fields after a sync; with unit tests  {agent=loop-implementer effort=high}
- [ ] Add the filings repository `src/data/repositories/filings.ts`: insert filings on conflict do nothing, delete a company's filings before a cutoff, page filings with base-form filter and sort, summary counts and latest 10-K per selected company; with unit tests  {agent=loop-implementer effort=high}
- [ ] Wire the companies list and update flows to the companies repository through their injected `deps`  {agent=loop-implementer effort=medium tests=module}
- [ ] Wire the filings list and summary flows to the filings and companies repositories through their injected `deps`, reading stored rows only  {agent=loop-implementer effort=medium tests=module}
- [ ] Add route tests showing an unknown ticker answers 404 on `GET /companies/:ticker/filings` and `PATCH /companies/:ticker`, and the page past the last returns `items: []` with the real total  {agent=tdd-guide effort=medium tests=module}
- [ ] Add tests showing seeding twice leaves 8,009 companies and 10,414 tickers, `AEM` and `AEMRF` resolve to CIK 2809, the company list is alphabetical, and `PATCH` with `selected: true` twice leaves the company selected  {agent=tdd-guide effort=high tests=module}
- [ ] Run the database-and-seed gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: SEC fetching

```rafa:stage-context
The flow is "Ingest flow (one company)" in `setup-prompt.md`; the parsers are "Code snippets /
parsing algorithms" (`SubmissionsHeader` loose, `columnsToRows`, `withinRetention`, `splitForm`,
`toFiling`, `buildLinks`) and the URLs are "Link templates". The client and parsers live under
`src/sec/`; the client takes an injected `fetch`, so every test runs on a stub `fetch` and no test
in this stage reaches sec.gov. SEC answers 403 without a declared User-Agent and 429 above 10
requests per second. `GET /filings/summary` never calls SEC.
```

- [ ] Add `SEC_USER_AGENT` to the service configuration, validated at startup so the service refuses to start without it, commented out with a placeholder contact in `.env.example`, and in the configuration table of `docs/setup.md`, with tests of the refusal and of `tests/docs/env.test.ts` passing  {agent=loop-implementer effort=high tests=full}
- [ ] Add the SEC client `src/sec/client.ts` over an injected `fetch`: sends the `SEC_USER_AGENT` User-Agent, keeps to 10 requests per second or fewer, maps 403, 404, 429 and network errors to typed errors, with unit tests  {agent=loop-implementer effort=high}
- [ ] Add the submissions parsers `src/sec/parse.ts` per "Code snippets / parsing algorithms": `SubmissionsHeader`, `columnsToRows`, `withinRetention`, `splitForm`, `toFiling`, `buildLinks`, with unit tests  {agent=loop-implementer effort=high}
- [ ] Add the sync flow `src/routes/filings/sync.flow.ts` per "Ingest flow (one company)" with `SYNC_TTL_HOURS = 24` and `RETENTION_DAYS = 365`, called by the filings list flow when the data is stale and by the companies update flow before it answers `selected: true`, with unit tests  {agent=loop-implementer effort=high tests=module}
- [ ] Inject the SEC client into the deps of the filings and companies routes and MCP tools  {agent=loop-implementer effort=medium tests=module}
- [ ] Add stub-`fetch` tests showing a 403 answers 502 when no rows are stored, and serves the stale rows with their `filingsSyncedAt` when some are  {agent=tdd-guide effort=medium tests=module}
- [ ] Add stub-`fetch` tests showing a second request within the TTL makes no SEC call, rows older than the 365-day cutoff are deleted on sync, and the request carries the `SEC_USER_AGENT` value  {agent=tdd-guide effort=medium tests=module}
- [ ] Run the SEC-fetching gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Response and link validation

```rafa:stage-context
The cases come from "Edge cases for test suite" and "DoD verification" in `setup-prompt.md`. The
contract test pins `now = 2026-11-11`: 1001 rows parse with 0 failures, and the last-year cut
keeps 94 rows of every form, 13 of them in the three tracked forms (1 × 10-K, 3 × 10-Q,
9 × 8-K). The live probe is off unless `SEC_LIVE=1` and must report as skipped (`test.skipIf`),
never as passed, when it is off.
```

- [ ] Copy `.tmp/APPL-CIK0000320193.json` to `tests/fixtures/sec/aapl-submissions.json` and cut from it a 5-row fixture `tests/fixtures/sec/aapl-five-rows.json` holding one 10-K, 8-K, Form 4, 424B2 and UPLOAD row, reading no other file under `.tmp/`  {agent=loop-implementer effort=low}
- [ ] Add unit tests over the 5-row fixture for every case in "Edge cases for test suite" that the parsers own, including column arrays of different lengths making the ingest throw  {agent=tdd-guide effort=high}
- [ ] Add the contract test `tests/contract/aapl-submissions.test.ts` holding the 1001-row parse with 0 failures and the 94-row last-year cut with 13 tracked rows at `now = 2026-11-11`  {agent=tdd-guide effort=medium tests=module}
- [ ] Add the live probe `tests/contract/sec-live.test.ts`, skipped unless `SEC_LIVE=1`, sending `HEAD` to the document, index and ix viewer links built for Apple's 10-K `0000320193-26-000026` and expecting 200 for each  {agent=tdd-guide effort=medium}
- [ ] Run the response-and-link-validation gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Companies page

```rafa:stage-context
"Front end" in `setup-prompt.md` describes the page. UI comes from `@open-tomato/components`.
Web checks are render tests (`renderToStaticMarkup`) in `tests/web/pages.test.tsx` and the
page's own `tests/web/companies.test.tsx`; no visual or screenshot tests. The name button calls an
`onOpenFilings(ticker)` prop that the Filings view stage wires.
```

- [ ] Scaffold the Companies page with `/fe empty-page companies`  {agent=loop-implementer effort=low skills=fe tests=module}
- [ ] Add the Companies page `Toolbar` with a debounced `q` search, a selected-only filter and pagination controls over `GET /companies`  {agent=loop-implementer effort=medium}
- [ ] Add the Companies page rows, one `RowStatCard` per company on the stats-only story with the name as a `ghost` `Button` calling `onOpenFilings` and a `Switch` sending `PATCH selected` with an explicit boolean, falling back to `DecoratedToggle`, then `OptionCard`, then a `Table` with a toggle column  {agent=loop-implementer effort=high}
- [ ] Add render tests showing an API error on the Companies page shows a message rather than an empty list, rows render from the API stub, and the switch sends the `PATCH` with an explicit boolean  {agent=tdd-guide effort=medium tests=module}
- [ ] Run the Companies page gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Filings view

```rafa:stage-context
"Front end" in `setup-prompt.md` describes options A and B and the `EntityCard` example. Both
bodies are fed by `GET /companies/:ticker/filings` and sit behind one toggle in the view's
header. Groups are the three tracked forms. `TreeNav` replaces `Accordion` only if `Accordion`
cannot hold the links.
```

- [ ] Add the filings view `src/web/components/filings-view.tsx`: a `Drawer` (option B) and a full-screen `Modal` (option A) behind one toggle, fed by `GET /companies/:ticker/filings`, topped by an `EntityCard` titled `Latest: 10-K <date>` opening `links.document` and shown only when a 10-K exists  {agent=loop-implementer effort=high}
- [ ] Add the filings view drawer body: an `Accordion` with one group per tracked form, each child showing the filing date and `primaryDocument`, linking to `links.document` and adding the ix viewer link when present  {agent=loop-implementer effort=medium}
- [ ] Add the filings view modal body: a 3-column grid with one `SectionCard` per tracked form listing its filings and links  {agent=loop-implementer effort=medium}
- [ ] Wire the Companies page `onOpenFilings` to open the filings view for the chosen ticker  {agent=loop-implementer effort=low}
- [ ] Add render tests showing a company with no 10-K shows no latest card, the groups match the three forms, and the links carry the built sec.gov URLs  {agent=tdd-guide effort=medium tests=module}
- [ ] Run the Filings view gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Summary page

```rafa:stage-context
"Front end" in `setup-prompt.md` describes the page; it reads `GET /filings/summary` and never
triggers an SEC call. The chart comes from `@open-tomato/charts`, installed by the operator
before the loop (PREREQUISITES); a task that finds it missing reports it as a blocker.
```

- [ ] Scaffold the Summary page with `/fe empty-page summary`  {agent=loop-implementer effort=low skills=fe tests=module}
- [ ] Add the Summary page's three compact `SmallStatCard`: total filings of the selected companies, average per company, latest filing  {agent=loop-implementer effort=medium}
- [ ] Add the Summary page `Table`: ticker `Badge`, the name as a `ghost` `Button` opening the filings view, one column per tracked form, and a Remove button behind `ConfirmPopover` sending `PATCH selected: false`  {agent=loop-implementer effort=high}
- [ ] Add the Summary page stacked bar chart from `@open-tomato/charts`: filings per company, one stack per tracked form  {agent=loop-implementer effort=medium}
- [ ] Add render tests showing an empty selection shows a pointer to the Companies page, Remove asks first and then sends the `PATCH`, and the table lists the selected companies  {agent=tdd-guide effort=medium tests=module}
- [ ] Run the Summary page gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Close-out

- [ ] Verify the definition of done on a scratch `DATABASE_URL` under `.tmp/scratch/`: a fresh `bun run db:migrate`, `bun run db:seed` twice leaving 8,009 companies and 10,414 tickers, `SEC_LIVE=1 bun test tests/contract/sec-live.test.ts` green, an in-process `PATCH /companies/AAPL` with `selected: true` and an API key followed by `GET /companies/AAPL/filings` listing filings with sec.gov `links.document`, `bash scripts/privacy-history.sh origin/main..HEAD` exiting 0, and `git merge-tree --write-tree origin/main HEAD`, recording each output in the close-out notes  {agent=loop-implementer effort=medium}
- [ ] Repair the docs of what this plan changed  {agent=doc-updater docs=repair effort=medium}
