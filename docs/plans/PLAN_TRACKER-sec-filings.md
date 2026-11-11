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

- [x] Add the `companies` table with `/db add companies` per "DB tables", both dialects, with its generated drizzle migrations  {agent=loop-implementer effort=medium skills=db tests=module}
  - Note: `companies` lives in `src/data/<dialect>/tables/companies.ts`; `company_tickers` belongs in the same file. Migrations `0001_add-companies` in both `drizzle/` folders. `db:migrate` was not run against `data/` (the plan forbids editing it); the migrated `:memory:` tests apply it instead.
- [x] Add the `company_tickers` table with `/db add company_tickers` per "DB tables", both dialects, with its generated drizzle migrations  {agent=loop-implementer effort=medium skills=db tests=module}
  - Note: `companyTickers` sits beside `companies` in `src/data/<dialect>/tables/companies.ts`; `cik` is `notNull` with `onDelete: 'cascade'` (Postgres only, SQLite runs FKs off). Migrations `0002_add-company_tickers` in both `drizzle/` folders; no index on `company_tickers.cik` beyond what "DB tables" names. `db:migrate` not run against `data/`.
- [x] Add the `filings` table with `/db add filings` per "DB tables", including the `(cik, filing_date DESC)` and `(cik, base_form)` indexes, both dialects, with its generated drizzle migrations  {agent=loop-implementer effort=medium skills=db tests=module}
  - Note: `filings` lives in `src/data/<dialect>/tables/filings.ts`. The five links are stored as `document_url`, `index_url`, `folder_json_url`, `inline_xbrl_viewer_url` and `raw_xml_url`; the repository maps them to and from `FilingLinks`. On Postgres `filing_date` and `report_date` are `date` with `mode: 'string'`, while on SQLite they are `YYYY-MM-DD` text, and `accepted_at` is text on both. Indexes `filings_cik_filing_date_idx` and `filings_cik_base_form_idx`; SQLite spells the `desc` as SQL because sqlite-core has no `.desc()`. Migrations `0003_add-filings` in both `drizzle/` folders. `db:migrate` was run against a scratch file only, never against `data/`.
- [x] Copy `.tmp/company_tickers.json` to `src/data/seeds/data/company_tickers.json`, reading no other file under `.tmp/`  {tools=Read,Bash model=haiku effort=low}
  Close-out: copied `.tmp/company_tickers.json` byte-for-byte (cmp identical, 1,057,333 bytes, 10,414 entries) to `src/data/seeds/data/company_tickers.json`. Privacy sweep: the only pattern hits are public company names ("Secret", "Token"); no paths, emails or keys. No test file added or edited; no code reads the copy yet, so no `bun test` target was reached.
- [x] Add the seed `src/data/seeds/01-companies.ts` per "Seed": validate with `TickerFile`, one company per CIK with the first ticker as primary, every ticker in `company_tickers`, chunks of 500 with `onConflictDoNothing`, with unit tests over a small inline ticker list  {agent=loop-implementer effort=high skills=db}
  - Note: `TickerEntry` and `TickerFile` did not exist anywhere, so they are defined and exported in `src/data/seeds/01-companies.ts` beside `toSeedRows`, `chunked`, `seedTickers` and `seed(db, path = TICKERS_FILE)`; move them if `src/sec/` wants them. A ticker listed twice keeps its first CIK. Tests: `tests/data/seeds/companies.test.ts` (16 pass); controls of chunk size 1000 and no `onConflictDoNothing` each turned tests red. `runSeeds` on the real file, run twice against a migrated `:memory:` database, read 8,009 companies and 10,414 tickers both times, with `AEM` and `AEMRF` on CIK 2809. `tests/data/seed.test.ts` `exits 0 and logs that no seeds ran` already failed at the base, because `src/data/seeds/` exists since the copy task; it is left as it is.
- [x] Add the companies repository `src/data/repositories/companies.ts`: list by name with `q` as ticker prefix or name contains, `selected`, page and total; resolve a ticker to its company; set `selected`; update the header fields after a sync; with unit tests  {agent=loop-implementer effort=high}
  - Note: `src/data/repositories/companies.ts` exports `listCompanies(db, { q, selected, offset, limit })` → `{ items, total }`, `findCompanyByTicker(db, ticker)`, `setCompanySelected(db, ticker, selected)` and `updateCompanyHeader(db, cik, { exchanges, sic, sicDescription, category, fiscalYearEnd, syncedAt })`. `findCompanyByTicker`, `setCompanySelected` and `updateCompanyHeader` answer a `Company` or `undefined`. Their inputs and outputs match the flows' `CompanyListQuery`/`CompanyListSlice` and `setSelected` structurally, so the wiring task can pass `(query) => listCompanies(db, query)` and `(ticker, selected) => setCompanySelected(db, ticker, selected)` without importing route types into `src/data`. `q` matches when ANY of a company's tickers starts with it (an EXISTS on `company_tickers`, so `AEMR` lists CIK 2809 once, under its primary `AEM`) or when the name contains it, in any case. `%`, `_` and `\` in `q` are escaped. Ordered by `name` then `cik`. The window and the count are two reads. Tests: `tests/repositories/companies.test.ts`, 28 pass. 7 of 8 mutation legs turned it red. The leg that survived drops `lower()`, because SQLite's `like` already ignores ASCII case, so Postgres case-insensitivity is untested here (there is no `TEST_PG_URL`, and the repository's tables are the active dialect's).
- [x] Add the filings repository `src/data/repositories/filings.ts`: insert filings on conflict do nothing, delete a company's filings before a cutoff, page filings with base-form filter and sort, summary counts and latest 10-K per selected company; with unit tests  {agent=loop-implementer effort=high}
  - Note: `src/data/repositories/filings.ts` exports `insertFilings(db, filings)` → the count newly stored (`onConflictDoNothing` on `accession_number`, chunks of `INSERT_CHUNK_SIZE` 500 inside one `transact`, so a refused chunk stores none), `deleteFilingsBefore(db, cik, cutoff)` → the count deleted (strictly before `YYYY-MM-DD`, the cutoff day kept; any other spelling throws `RangeError`), `pageFilings(db, { cik, form, sort, offset, limit })` → `{ items: Filing[], total }` (by `filing_date`, then `accepted_at`, then accession, all in the `sort` direction; `form` matches `base_form`, so `10-K/A` is under `10-K`) and `summarizeSelectedFilings(db, { form, offset, limit })` → `{ items, total }` (selected companies by name then CIK). Their shapes match the flows' `FilingPageQuery`/`FilingSlice` and `SummaryQuery`/`SummarySlice` structurally, so the wiring task can pass `(query) => pageFilings(db, query)` and `(query) => summarizeSelectedFilings(db, query)`.
  - Note: the open question on the summary's `form` is settled here: it narrows the counts to that form (the other forms count 0, `total` counts that form) and keeps every selected company, so `total` stays the count of selected companies, as the contract ("narrow the counts to") and the flow's `SummarySlice.total` ("the count of every selected company") say. `latest10K` ignores `form`, and it is the newest stored filing of base form `10-K`, so a later `10-K/A` wins. `filingStubStore.summary` still keeps only the companies with a filing of the form; its TSDoc now says the repository reads it the other way, and the wiring task replaces the stub.
  - Note: tests are in `tests/repositories/filings.test.ts` (21 pass). 12 of 13 mutation legs turned it red; the survivor drops the empty-window early return, which changes no answer. The chunk test uses 3,000 rows because one unchunked insert was measured to fail from 2,979 rows (65,538 values: `SQLite query expected 2 values, received 65538`, where Bun's binding wraps past 65,535). 1,600 rows had not failed, so SQLite's documented 32,766 cap does not apply to this Bun build. Postgres is not exercised (no `TEST_PG_URL`); `bun run typecheck:pg` passes.
- [x] Wire the companies list and update flows to the companies repository through their injected `deps`  {agent=loop-implementer effort=medium tests=module}
  - Note: `src/routes/companies/repository.ts` exports `companyStore(db)` → `{ list, setSelected }` over `listCompanies` and `setCompanySelected` from `src/data/repositories/companies.ts`; `http.ts` and `tool.ts` pass `companyStore(db)` from their run context's `db`. `companyStubStore` is removed from `src/routes/companies/stub.ts`; `STUB_COMPANIES` stays there because `src/routes/filings/stub.ts` and the filings tests still read it, so the filings wiring task can delete the file once it no longer does. The companies route, tool and stub-output tests now run on a seeded `:memory:` database from `tests/routes/companies/seeded-db.ts` (4 companies, `AEM`/`AEMRF` on CIK 2809); `tests/routes/companies/repository.test.ts` covers the store. A control that inverted `selected` and dropped the offset turned 8 tests red.
- [x] Wire the filings list and summary flows to the filings and companies repositories through their injected `deps`, reading stored rows only  {agent=loop-implementer effort=medium tests=module}
  - Note: `src/routes/filings/repository.ts` exports `companyLookupStore(db)` → `{ findByTicker }` over `findCompanyByTicker` and `filingStore(db)` → `{ page, summary }` over `pageFilings` and `summarizeSelectedFilings`; `http.ts` and `tool.ts` pass them from their run context's `db`. Both stub files, `src/routes/filings/stub.ts` and `src/routes/companies/stub.ts`, are deleted with `tests/routes/filings/stub.test.ts`; the fixed companies and Apple's 10-K moved to `tests/routes/fixtures.ts` as `FIXED_COMPANIES`, `APPLE_10K` and `FIXED_FILINGS`. The filings route, tool and stub-output tests run on `tests/routes/filings/seeded-db.ts` (the seeded companies, Apple alone selected, `FIXED_FILINGS` stored through `insertFilings`); `tests/routes/filings/repository.test.ts` covers the two stores. With the repository's reading of `form`, a summary with a form no selected company filed now answers the selected companies with zero counts, not an empty page. Two controls (truncating the ticker and pinning the summary offset; dropping the `form` filter) turned 10 and 2 tests red.
- [x] Add route tests showing an unknown ticker answers 404 on `GET /companies/:ticker/filings` and `PATCH /companies/:ticker`, and the page past the last returns `items: []` with the real total  {agent=tdd-guide effort=medium tests=module}
  - Note: the wiring tasks already left these cases in `tests/routes/filings/http.test.ts` (`NOPE` on `GET /api/companies/NOPE/filings` answers 404 `NotFoundError`; `?page=2` answers `items: []`, `page: 2`, `total: FIXED_FILINGS.length`) and `tests/routes/companies/http.test.ts` (`PATCH /api/companies/NOPE` answers 404). All 29 tests in the two files pass against the real seeded database; no test file was changed.
- [x] Add tests showing seeding twice leaves 8,009 companies and 10,414 tickers, `AEM` and `AEMRF` resolve to CIK 2809, the company list is alphabetical, and `PATCH` with `selected: true` twice leaves the company selected  {agent=tdd-guide effort=high tests=module}
  - Note: `tests/routes/companies/real-ticker-file.test.ts` runs `runSeeds(db)` over the real `company_tickers.json` and checks the counts (8,009 / 10,414, also after a third run), `AEM` and `AEMRF` on CIK 2809, the first three pages of `GET /api/companies` in case-insensitive alphabetical order, and `PATCH` `selected: true` twice (and a re-seed after it). The real file found two defects in `listCompanies` that the 5-company fixtures hid, both fixed in `src/data/repositories/companies.ts`: the `q` search used a per-company `exists` over `company_tickers` and took about 6 s on 8,009 companies (now an uncorrelated `inArray` subquery), and the order was binary, so `3M CO` came before `3i GROUP PLC` (now `lower(name)`, then `name`, then `cik`; a unit test in `tests/repositories/companies.test.ts` pins it). The `(name)` index no longer serves the order; the table comments and `setup-prompt.md` say so.
- [x] Run the database-and-seed gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: SEC fetching

```rafa:stage-context
The flow is "Ingest flow (one company)" in `setup-prompt.md`; the parsers are "Code snippets /
parsing algorithms" (`SubmissionsHeader` loose, `columnsToRows`, `withinRetention`, `splitForm`,
`toFiling`, `buildLinks`) and the URLs are "Link templates". The client and parsers live under
`src/sec/`; the client takes an injected `fetch`, so every test runs on a stub `fetch` and no test
in this stage reaches sec.gov. SEC answers 403 without a declared User-Agent and 429 above 10
requests per second. `GET /filings/summary` never calls SEC.
```

- [x] Add `SEC_USER_AGENT` to the service configuration, validated at startup so the service refuses to start without it, commented out with a placeholder contact in `.env.example`, and in the configuration table of `docs/setup.md`, with tests of the refusal and of `tests/docs/env.test.ts` passing  {agent=loop-implementer effort=high tests=full}
  - Close-out: `readSecUserAgent` in `src/sec/config.ts` (throws `InvalidSecUserAgentError` when unset, blank, without a contact email or with a control character) runs first in `startService`; the MCP server (`src/mcp/server.ts`) does not check it yet, for the injection task to decide.
  - Test runs no longer lean on a developer `.env`: `tests/support/service-process.ts` and `tests/http/server.test.ts` set a made-up `SEC_USER_AGENT`. With `SEC_USER_AGENT=` blanked, 32 of 34 start tests failed before that.
- [x] Add the SEC client `src/sec/client.ts` over an injected `fetch`: sends the `SEC_USER_AGENT` User-Agent, keeps to 10 requests per second or fewer, maps 403, 404, 429 and network errors to typed errors, with unit tests  {agent=loop-implementer effort=high}
  - Close-out: `createSecClient({ fetch, userAgent, timeoutMs?, now?, sleep? })` in `src/sec/client.ts` returns `getSubmissions(cik10)`, which resolves the unchecked JSON body (the parsers task checks the shape). Request starts are spaced by `MIN_REQUEST_INTERVAL_MS` (100 ms) per client, so the injection task builds one client and shares it.
  - Errors: `SecRequestError` (`status`, `url`), with subclasses `SecForbiddenError` 403, `SecNotFoundError` 404, `SecRateLimitedError` 429 and `SecNetworkError` (`status: null`, connection failure or timeout). A different non-2xx status, or a 2xx body that is not JSON, is the base class. `src/errors.ts` `statusFor`/`isKnownError` do not know them yet: mapping them to 502 is left to the sync or 502-test task.
- [x] Add the submissions parsers `src/sec/parse.ts` per "Code snippets / parsing algorithms": `SubmissionsHeader`, `columnsToRows`, `withinRetention`, `splitForm`, `toFiling`, `buildLinks`, with unit tests  {agent=loop-implementer effort=high}
  - Close-out: `src/sec/parse.ts` exports the loose zod schemas `SubmissionsHeader`, `FilingColumns`, `OverflowFileRef`, `Address` (plain `z.object`: unknown keys are accepted and dropped), the `RawRow` type, and `columnsToRows`, `withinRetention(rows, now)`, `splitForm`, `buildLinks`, `toFiling` as the spec writes them. Tests: `tests/sec/parse.test.ts`, 32 tests; a two-line mutation (`>=` to `>` in the cut, `isAmendment` forced `false`) failed 5 of them.
  - `RETENTION_DAYS = 365` is exported from `src/sec/parse.ts`, as the spec's "Last-year cut" snippet has it, along with `retentionCutoff(now)` (the `YYYY-MM-DD` date that `withinRetention` keeps from). The plan names it a constant of the sync flow: the sync task should re-export it and reuse `retentionCutoff` for the delete step, not define a second 365.
  - The 5-row fixture is inline in the test and written by hand in the Apple shape (the 10-K row is the spec's example response). No `.tmp/` file was read, so it is not a cut of the real file; the 1001-row contract test is the check on the real document.
- [x] Add the sync flow `src/routes/filings/sync.flow.ts` per "Ingest flow (one company)" with `SYNC_TTL_HOURS = 24` and `RETENTION_DAYS = 365`, called by the filings list flow when the data is stale and by the companies update flow before it answers `selected: true`, with unit tests  {agent=loop-implementer effort=high tests=module}
  - Close-out: `src/routes/filings/sync.flow.ts` exports `SYNC_TTL_HOURS` (24), `RETENTION_DAYS` (re-exported from `src/sec/parse.ts`), `isStale(company, now)` (null, unparsable, or more than 24 h old; exactly 24 h is fresh), `syncFilings(company, deps)`, `syncIfStale(company, deps)`, `SecDocumentError` (a `SecRequestError`, status recorded as 200, for a document that breaks `SubmissionsHeader`, `columnsToRows` or `Filing`), and the dep types `FilingSyncSources` (`sec.getSubmissions`, `companies.updateHeader`, `filings.insert`/`deleteBefore`, `now`) and `SyncFilingsDeps` (plus `log`).
  - The order differs from the spec's diagram on purpose: the whole document is parsed before any write, then insert, then delete before `retentionCutoff(now)`, then the header with `filingsSyncedAt` last, so a sync that fails part way leaves the company stale. Only the three tracked base forms are stored, so the unfiltered list keeps to "every tracked form when absent" (`pageFilings` with no `form` returns every stored form).
  - Fallback: `syncIfStale` serves the stored company when SEC fails (any `SecRequestError`) and `filingsSyncedAt` is not null, and rethrows when it is null. A store error is rethrown either way. `src/errors.ts` now maps `SecRequestError` and its subclasses to 502 and shows their name and message (`isKnownError`).
  - Callers: `ListFilingsDeps.sync?` and `UpdateCompanyDeps.sync?` are optional `FilingSyncSources`; without them the flows behave as before. `updateCompany` with `selected: true` resolves the company (`store.findByTicker`, added to `companyStore`), syncs, then sets the flag, so a 502 for a never-synced company leaves it unselected. `selected: false` never syncs.
  - For the injection task: routes and tools pass no `sync` yet, so nothing calls SEC. It needs store adapters over `updateCompanyHeader`, `insertFilings` and `deleteFilingsBefore` (shapes match), one shared `SecClient`, and `now: () => new Date()`. Once wired, `filing_list` is no longer `readOnlyHint: true, openWorldHint: false`, and the `company_update` description should say it syncs. Consider making `sync` required then.
  - Tests: `tests/routes/filings/sync.flow.test.ts` (24), sync cases in `list.flow.test.ts` and `companies/update.flow.test.ts`, `findByTicker` in `companies/repository.test.ts`, and the 502 mapping in `tests/errors.test.ts`; the fakes are in `tests/routes/filings/fake-sync.ts`. 7 single-line mutations (TTL `>=`, no tracked filter, serving with no earlier sync, header first, list skipping the sync, update syncing after the set, no 502) each turned 1 to 5 tests red.
- [x] Inject the SEC client into the deps of the filings and companies routes and MCP tools  {agent=loop-implementer effort=medium tests=module}
  - Close-out: the client travels as an optional `sec` from each entry point. `src/http/server.ts` builds one `createSecClient({ fetch, userAgent: readSecUserAgent(process.env) })` and passes it as the fifth argument of `mountRoutes`, then `RouteSpec.handler(db, log, sec)`, `JsonHandlerOptions.sec` and `RouteRunContext.sec`. `src/mcp/server.ts` builds its own and passes it as `McpSetup.sec`, then `registerTools(..., sec)` and `ToolRunContext.sec`.
  - `syncSourcesFor(db, sec)` in `src/routes/filings/repository.ts` builds `FilingSyncSources` over `updateCompanyHeader`, `insertFilings`, `deleteFilingsBefore` and `() => new Date()`, or answers `undefined` without a client. The `filing_list` and `company_update` routes and tools pass it as `deps.sync`; the companies files import it from `../filings/repository.ts`.
  - Tests that mount or register without `sec` keep reading the stored rows only, so no existing test reaches SEC. For the next tasks, `connectTools(defs, db, log, sec)` in `tests/support/tool-harness.ts` and `mountRoutes(app, db, log, 'none', sec)` take a client over a stub `fetch`.
  - The MCP server now refuses to start without a usable `SEC_USER_AGENT`, as `serve` does: it exits 1 with the message on stderr. `tests/mcp/stdio.test.ts` gives the child a made-up value and checks the refusal.
  - Tests: `tests/routes/filings/sec-injection.test.ts`, 10 tests. With `sync: syncSourcesFor(db, sec)` removed from the four call sites, 4 of them failed. Against the base `src/mcp/server.ts`, the stdio refusal test failed.
- [x] Add stub-`fetch` tests showing a 403 answers 502 when no rows are stored, and serves the stale rows with their `filingsSyncedAt` when some are  {agent=tdd-guide effort=medium tests=module}
- [x] Add stub-`fetch` tests showing a second request within the TTL makes no SEC call, rows older than the 365-day cutoff are deleted on sync, and the request carries the `SEC_USER_AGENT` value  {agent=tdd-guide effort=medium tests=module}
  - Tests: `tests/routes/filings/sec-ttl-retention.test.ts`, 3 tests over the real SEC client and a stub `fetch` (TTL: one call across two requests; cutoff: a stored row 400 days old is gone after the sync; User-Agent: the `readSecUserAgent` value reaches the stub). The routes read the wall clock, so the filing dates are computed from it.
- [x] Run the SEC-fetching gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}
  Close-out: lint, typecheck, typecheck:pg and privacy all exit 0 with no changes needed (privacy: 0 findings, no denylist).

# Stage: Response and link validation

```rafa:stage-context
The cases come from "Edge cases for test suite" and "DoD verification" in `setup-prompt.md`. The
contract test pins `now = 2026-11-11`: 1001 rows parse with 0 failures, and the last-year cut
keeps 94 rows of every form, 13 of them in the three tracked forms (1 × 10-K, 3 × 10-Q,
9 × 8-K). The live probe is off unless `SEC_LIVE=1` and must report as skipped (`test.skipIf`),
never as passed, when it is off.
```

- [x] Copy `.tmp/APPL-CIK0000320193.json` to `tests/fixtures/sec/aapl-submissions.json` and cut from it a 5-row fixture `tests/fixtures/sec/aapl-five-rows.json` holding one 10-K, 8-K, Form 4, 424B2 and UPLOAD row, reading no other file under `.tmp/`  {agent=loop-implementer effort=low}
  - Note: five-row fixture keeps the full top-level object with `filings.recent` cut to source rows 6 (10-K 0000320193-26-000026), 1 (8-K), 4 (Form 4), 2 (424B2), 212 (UPLOAD), in that order; the full copy is byte-identical to the source.
- [x] Add unit tests over the 5-row fixture for every case in "Edge cases for test suite" that the parsers own, including column arrays of different lengths making the ingest throw  {agent=tdd-guide effort=high}
  - Note: `tests/sec/parse-fixture.test.ts` reads `aapl-five-rows.json` and covers the parser-owned cases: empty strings, filing-agent accession, `xsl…/` rawXml, `core_type` ignored, `.pdf` links, misaligned columns, padded header `cik` against integer `cik`, `10-K/A`. The seed, repository and flow cases (`AEMRF`, no 10-K, TTL, page past the last) are not parser-owned. The real fixture holds `isXBRLNumeric: null` on the UPLOAD row, which `FilingColumns` refused; it is now `z.number().nullable()` in `src/sec/parse.ts` and `setup-prompt.md`. The contract test on the 1001-row file needed that too.
- [x] Add the contract test `tests/contract/aapl-submissions.test.ts` holding the 1001-row parse with 0 failures and the 94-row last-year cut with 13 tracked rows at `now = 2026-11-11`  {agent=tdd-guide effort=medium tests=module}
  - note: the 13 tracked rows are counted by the form as filed (1 10-K, 3 10-Q, 9 8-K); the last year also holds one 8-K/A (2026-09-01), so counting amendments under their base form gives 14. The test pins both.
- [x] Add the live probe `tests/contract/sec-live.test.ts`, skipped unless `SEC_LIVE=1`, sending `HEAD` to the document, index and ix viewer links built for Apple's 10-K `0000320193-26-000026` and expecting 200 for each  {agent=tdd-guide effort=medium}
- [x] Run the response-and-link-validation gates `bun run lint`, `bun run typecheck`, `bun run typecheck:pg` and `bun run privacy`, fixing what they report  {agent=build-error-resolver effort=medium tests=full}

# Stage: Companies page

```rafa:stage-context
"Front end" in `setup-prompt.md` describes the page. UI comes from `@open-tomato/components`.
Web checks are render tests (`renderToStaticMarkup`) in `tests/web/pages.test.tsx` and the
page's own `tests/web/companies.test.tsx`; no visual or screenshot tests. The name button calls an
`onOpenFilings(ticker)` prop that the Filings view stage wires.
```

- [x] Scaffold the Companies page with `/fe empty-page companies`  {agent=loop-implementer effort=low skills=fe tests=module}
- [x] Add the Companies page `Toolbar` with a debounced `q` search, a selected-only filter and pagination controls over `GET /companies`  {agent=loop-implementer effort=medium}
  - Close-out: `CompaniesToolbar` in `src/web/pages/companies.tsx` holds `SearchInput` (300 ms
    debounce into `q`), a `Selected only` `Checkbox` (sends `selected=true` or nothing) and
    Previous/Next `Button`s around `Page n of N`; the library `Pagination` draws one button per
    page, so it was not used. `companiesPath` and `createCompaniesClient` are in `src/web/api.ts`.
    The rows task renders `result.items`; the view shows only the toolbar, an error alert and the
    empty state today. The debounce timer itself has no test: `renderToStaticMarkup` runs no
    effects and the repo has no DOM test environment.
- [x] Add the Companies page rows, one `RowStatCard` per company on the stats-only story with the name as a `ghost` `Button` calling `onOpenFilings` and a `Switch` sending `PATCH selected` with an explicit boolean, falling back to `DecoratedToggle`, then `OptionCard`, then a `Table` with a toggle column  {agent=loop-implementer effort=high}
  - Close-out: `CompanyRow` in `src/web/pages/companies.tsx` is a `RowStatCard` (stats-only
    story): ticker as `title`, the name as a `ghost` `Button` in `subtitle` calling
    `onOpenFilings(ticker)`, ministats `cik`, `exchange` and `synced`, and a `Switch` in `action`
    calling `onSelectedChange(ticker, next)`. `RowStatCard`'s `title` is typed `string`, so the
    button cannot sit there; `subtitle` and `action` take a `ReactNode`. No fallback was needed:
    `DecoratedToggle` and `OptionCard` both render a root `<button>` (measured with
    `renderToStaticMarkup` on the installed 0.1.1), so a `Button` inside would nest. The client's
    `select(ticker, selected)` in `src/web/api.ts` sends `PATCH /api/companies/:ticker` with
    `{ selected }`; `withCompany` puts the server's answer into the page. `CompaniesPage` takes
    `onOpenFilings` for the Filings view stage to wire; `PAGES` does not pass it yet.
- [x] Add render tests showing an API error on the Companies page shows a message rather than an empty list, rows render from the API stub, and the switch sends the `PATCH` with an explicit boolean  {agent=tdd-guide effort=medium tests=module}
  note: render tests are in tests/web/companies.test.tsx; effects need a DOM, so a small hook-dispatcher probe (`settle`) drives CompaniesPage against a recording fetch stub.
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
