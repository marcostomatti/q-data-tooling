## Overview

I'm starting a tech assessment. The goal: based on a company ticker, the service provides search
and fetch functionality for company summaries and their submitted filings.

For this repo we're using `@open-tomato/template-service`, which bootstraps with express, DB
support via drizzle, our service core features and some extra add-ons. Skills for specific
scaffolding tasks are listed in @CLAUDE.md. The template's OpenAPI and TypeDoc tooling is merged
in, so no docs packages or tooling are added from our side.

Below is the job to be done, plus snippets and schemas prepared earlier, to be used as templates
for the code generation.

## First run

```sh
bun install
cp .env.example .env
bun run set-password            # once: asks twice, writes AUTH_MODE=password + the hash into .env
# in .env: SEC_USER_AGENT="<app name> <contact email>"   (SEC refuses requests without it)
bun run db:migrate              # creates data/app.db and its tables; `serve` does not migrate
bun run db:seed                 # loads 10,414 tickers / 8,009 companies
bun run serve                   # sign in at /login; API docs at /api/docs
```

## Tasks

1. **Filings**: fetch the company's submissions (its filing history) from the EDGAR submissions
   API. The fetch logic uses the company's ticker.
   - URI: `[GET] /companies/{:ticker}/filings`
   - Params:
     - @path ticker (string)
     - @param form (enum "10-K", "10-Q", "8-K")
     - @param PaginationControls
     - @param sort (filingDate)
   - Handler:
     1. Resolves the company by ticker through `company_tickers`; the CIK defines CIK10, kept in
        the context.
     2. Converts the response data structure to our data schema and filters out old data.
     3. Stores the company's filings of the last year in the DB.
     4. Responds with the company details and the filings, each linking to its original
        document.
2. **Summary**: for the selected companies (Task 3), returns each company's basic data (name,
   ticker, cik) and its filings per form type. The date of the latest 10-K is its own data point.
   - URI: `[GET] /filings/summary`
   - Params:
     - (optional) @param form (enum "10-K", "10-Q", "8-K")
     - (optional) @param PaginationControls
3. **Companies**: lists all companies, paginated. The summary query already gives the selected
   subset for the quick switch. A PATCH includes or removes a company from the summary list by
   setting `selected`.
   - Fetch all:
     - URI: `[GET] /companies`
     - Params:
       - (optional) @param PaginationControls
       - (optional) @param q: ticker prefix or name contains, for the Companies page search
       - (optional) @param selected (boolean)
     - Handler: fetches all companies (limited by pagination), alphabetically.
   - Update selected by ticker:
     - URI: `[PATCH] /companies/{:ticker}`
     - Body: `selected` (boolean), **required**. A toggle flips on every call, so a retried
       request would undo itself; an explicit value gives the same result however often it runs.
     - `selected: true` syncs the company's filings before answering, so every company in the
       summary has data.

### Scaffolding and additional work

- **DO** write tests and validation checks covering internal logic. They act as the task
  assessment against my implementation. As I move through the tasks I'll write more tests.
  - Validate the input schema.
  - Validate the response schema.
  - Validate TSDoc and the OpenAPI spec, using the template's `src/http/openapi.ts` and
    `bun run docs:generate`.
- Bootstrap the endpoints with the [schemas proposed below](#data-schemas) and shallow tests that
  check validation and that the response flow is valid. The OpenAPI document comes from the
  route table, so the filter and pagination fields appear once they are in the input schemas.
- No visual tests. The web checks are render tests in `tests/web/pages.test.tsx`.

## Known data and APIs

- `CIK` is a number. Some requests use it with leading `0`s, which we call `CIK10` internally, so
  it is clear whether it has been padded or not.
- `.tmp/company_tickers.json` seeds the companies with their tickers and CIKs. Stay away from the
  other files in that directory: they are submissions and other API response examples from
  sec.gov, and some are very big. `.tmp/` is gitignored, so the seed reads a copy at
  `src/data/seeds/data/company_tickers.json`.
- The file has 10,414 tickers and only 8,009 CIKs, because one company can have several tickers
  (AGNICO EAGLE: `AEM` and `AEMRF`). Companies are stored by CIK, and `company_tickers` maps each
  ticker to its CIK.
- The frontend search picks a ticker from the seeded list. Every route takes the ticker only, and
  the backend resolves it to the CIK through `company_tickers`; an unknown ticker is a 404.
- EDGAR submissions API: `data.sec.gov/submissions/CIK{cik10}.json`. Every request carries the
  `SEC_USER_AGENT` header and stays at 10 requests per second or fewer.

### Link templates

| Link                 | Template                                                                              | When                                |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| Primary document     | `https://www.sec.gov/Archives/edgar/data/{cik}/{accNoDash}/{primaryDocument}`         | always                              |
| Filing index (human) | `https://www.sec.gov/Archives/edgar/data/{cik}/{accNoDash}/{accession}-index.htm`     | always                              |
| Filing folder (JSON) | `https://www.sec.gov/Archives/edgar/data/{cik}/{accNoDash}/index.json`                | always                              |
| Inline XBRL viewer   | `https://www.sec.gov/ix?doc=/Archives/edgar/data/{cik}/{accNoDash}/{primaryDocument}` | `isInlineXBRL === 1`                |
| Raw XML              | same as primary, with the leading `xsl…/` segment removed                             | `primaryDocument` starts with `xsl` |
| Submissions          | `https://data.sec.gov/submissions/CIK{cik10}.json`                                    | per company                         |
| Overflow             | `https://data.sec.gov/submissions/{files[i].name}`                                    | older history (not used)            |

## Front end

Based on and updated from the original @NOTES.md front end definitions, with more detail on the
site's two pages. Use `@open-tomato/components` as the core UI library, and
`@open-tomato/charts` for the summary dashboard elements. Follow the package skills and agents.

- **Summary**:
  - Top row of 3 compact `SmallStatCard`: total submissions of the selected companies, average
    per company, latest submission.
  - Table with the companies in the summary. Each row:
    - `Badge` with the ticker.
    - Company name as a `ghost` variant `Button`, which opens the filings modal for that company.
    - One column per form.
    - `Remove` button on the last column, which removes the company from the summary after a
      `ConfirmPopover`.
  - Stacked bar chart with filings per company.
- **Companies**:
  - Control bar for search and filter over the results, plus pagination controls.
  - Each company in a `RowStatCard`, based on the stats-only example
    (`/story/molecules-rowstatcard--stats-only`) from the package stories.
    - Name as a `ghost` variant `Button`, which opens the filings modal for that company.
    - `Switch` on the right, selecting the company for the summary. If the component does not
      allow it, explore `DecoratedToggle`, if it supports a `ghost` `Button` in the title without
      conflicting with the touch event. Otherwise fall back to the summary's table with a toggle
      column. `OptionCard` is a possibility too.
- **Filings** (as a modal or a drawer; add a toggle before deciding):
  - Option A:
    - Top: a single `EntityCard` with the latest `10-K`. Title `Latest: 10-K <date>`; its action
      opens the link.
    - A full-screen modal with a 3 or 4 column grid, each column a `SectionCard` listing the
      filings of one form (`/story/molecules-sectioncard--full-bleed`).
  - Option B:
    - A right-side drawer taking 1/3 to 1/2 of the screen (with a reasonable max for the viewport
      width), holding a component that supports the form listings.
      - Top: a single `EntityCard` with the latest `10-K`. Title `Latest: 10-K <date>`; its
        action opens the link.
      - Variant 1: `Accordion`, first level the form types.
      - Variant 2: `TreeNav`, first level the form types.
      - The children are the filings, each with its date and its `primaryDocument` as the title.
  - `EntityCard` example:

```jsx
<EntityCard
  {...args}
  title="Latest 10-K"
  onOpen={() => undefined}
  meta={(
    <>
      <span className="text-fg3">Submitted</span>
      <span className="ml-auto font-medium">{LEAD_ROW.reviewed}</span>
    </>
  )}
>
  <p className="m-0 text-sm leading-relaxed text-fg2">aapl-20260926.htm</p>
</EntityCard>;
```

## Data schemas

### Tickers

The keys are "0", "1", ...; the values are what matter.

```ts
const TickerEntry = z.object({
  cik_str: z.number().int(),   // raw CIK, no padding: 320193
  ticker: z.string(),          // "AAPL"
  title: z.string(),           // "Apple Inc."
});
const TickerFile = z.record(z.string(), TickerEntry);
```

### Submissions document: company header

The schema is loose on purpose (`.passthrough()` or no `.strict()`), because EDGAR adds fields
without notice. Only the contracts we write ourselves are strict.

```ts
const Address = z.object({
  street1: z.string().nullable(),
  street2: z.string().nullable(),
  city: z.string().nullable(),
  stateOrCountry: z.string().nullable(),
  zipCode: z.string().nullable(),
  stateOrCountryDescription: z.string().nullable(),
  isForeignLocation: z.number().nullable(),       // 0 | 1 | null
  foreignStateTerritory: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
});

const SubmissionsHeader = z.object({
  cik: z.string(),                       // ZERO-PADDED here: "0000320193"
  entityType: z.string(),                // "operating"
  sic: z.string(),                       // "3571"
  sicDescription: z.string(),
  ownerOrg: z.string(),
  insiderTransactionForOwnerExists: z.number(),
  insiderTransactionForIssuerExists: z.number(),
  name: z.string(),
  tickers: z.array(z.string()),
  exchanges: z.array(z.string()),
  ein: z.string().nullable(),
  lei: z.string().nullable(),
  description: z.string(),               // often ""
  website: z.string(),                   // often ""
  investorWebsite: z.string(),
  category: z.string(),                  // "Large accelerated filer"
  fiscalYearEnd: z.string(),             // "MMDD", e.g. "0926"
  stateOfIncorporation: z.string(),
  stateOfIncorporationDescription: z.string(),
  addresses: z.object({ mailing: Address, business: Address }),
  phone: z.string(),
  flags: z.string(),
  formerNames: z.array(z.object({ name: z.string(), from: z.string(), to: z.string() })),
  filings: z.object({ recent: FilingColumns, files: z.array(OverflowFileRef) }),
});
```

### Filing columns

Shared by `filings.recent` and every overflow file.

The `recent` segment holds at most about the last 1000 filings, or one year of them. Older
filings are in `files[]`, each fetched from `https://data.sec.gov/submissions/{name}` with a
`FilingColumns` body at the top level. Only the last year is kept, so overflow files are never
fetched; `OverflowFileRef` stays in the schema so parsing passes.

```ts
const FilingColumns = z.object({
  accessionNumber: z.array(z.string()),   // "0000320193-26-000026"
  filingDate: z.array(z.string()),   // "YYYY-MM-DD"
  reportDate: z.array(z.string()),   // "YYYY-MM-DD" or ""  (225/1001 empty)
  acceptanceDateTime: z.array(z.string()),   // ISO, "2026-11-09T22:00:55.000Z"
  act: z.array(z.string()),   // "33" | "34" | ""
  form: z.array(z.string()),   // "10-K", "8-K", "4", "SC 13G/A", ...
  fileNumber: z.array(z.string()),
  filmNumber: z.array(z.string()),
  items: z.array(z.string()),   // "8.01,9.01" or ""  (8-K items)
  core_type: z.array(z.string()),   // "XBRL" for financial filings, else ≈ form
  size: z.array(z.number()),   // bytes
  isXBRL: z.array(z.number()),   // 0 | 1
  isInlineXBRL: z.array(z.number()),   // 0 | 1
  isXBRLNumeric: z.array(z.number()),   // 0 | 1
  primaryDocument: z.array(z.string()),   // "aapl-20260926.htm" | "xslF345X06/form4.xml"
  primaryDocDescription: z.array(z.string()),   // often ""
});

const OverflowFileRef = z.object({
  name: z.string(),          // "CIK0000320193-submissions-001.json"
  filingCount: z.number(),
  filingFrom: z.string(),
  filingTo: z.string(),
});
```

### Shared route schemas

The template ships no pagination helper; these live in `src/routes/common.ts`, beside
`IdSchema` and `booleanOrText`. Every response is wrapped by the template as
`{ success: true, data }`, so `pageOf` is the `data` part.

```ts
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

export const PaginationQuery = z.strictObject({
  page: numberOrNumericText.pipe(z.number().int()
    .min(1)).default(1),
  pageSize: numberOrNumericText.pipe(z.number().int()
    .min(1)
    .max(PAGE_SIZE_MAX)).default(PAGE_SIZE_DEFAULT),
});

export const pageOf = <T extends z.ZodType>(item: T) => z.strictObject({
  items: z.array(item),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const Ticker = z.string().regex(/^[A-Za-z0-9.-]{1,10}$/)
  .transform((t) => t.toUpperCase());
```

## Data normalization

There is one row per filing. Empty strings become `null`, `0`/`1` become booleans, `items` is
split into an array, and the links are built once, at ingest.

```ts
export const TrackedForm = z.enum(['10-K', '10-Q', '8-K']);

export const FilingLinks = z.object({
  document: z.string().url(),
  index: z.string().url(),
  folderJson: z.string().url(),
  inlineXbrlViewer: z.string().url()
    .nullable(),
  rawXml: z.string().url()
    .nullable(),
}).strict();

export const Filing = z.object({
  accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),  // primary key
  cik: z.number().int(),                                      // FK → companies
  form: z.string(),                                           // "10-K/A" kept verbatim
  baseForm: z.string(),                                       // "10-K" (no "/A")
  isAmendment: z.boolean(),
  filingDate: z.string(),                                     // YYYY-MM-DD
  reportDate: z.string().nullable(),
  acceptedAt: z.string(),                                     // ISO datetime
  act: z.string().nullable(),
  fileNumber: z.string().nullable(),
  filmNumber: z.string().nullable(),
  items: z.array(z.string()),                                 // ["8.01","9.01"]
  sizeBytes: z.number().int(),
  isXbrl: z.boolean(),
  isInlineXbrl: z.boolean(),
  primaryDocument: z.string(),
  description: z.string().nullable(),                         // primaryDocDescription
  links: FilingLinks,
}).strict();

// src/entities/company.ts
export const Company = z.strictObject({
  cik: z.number().int(),                 // PK, unpadded
  cik10: z.string().length(10),
  ticker: z.string(),                    // primary: the first one in company_tickers.json
  name: z.string(),
  selected: z.boolean(),                 // in the summary or not
  exchanges: z.array(z.string()),        // [] until the first sync
  sic: z.string().nullable(),
  sicDescription: z.string().nullable(),
  category: z.string().nullable(),
  fiscalYearEnd: z.string().nullable(),  // "MMDD"
  filingsSyncedAt: z.string().nullable(),
});

export const CompanyTicker = z.strictObject({
  ticker: z.string(),                    // PK
  cik: z.number().int(),                 // FK → companies
});

export const toCik10 = (cik: number) => String(cik).padStart(10, '0');
```

The fields that come only from the submissions document (`exchanges`, `sic`, `category`, ...)
stay empty until the company's first sync.

### Example response data

```json
{
  "accessionNumber": "0000320193-26-000026",
  "cik": 320193,
  "form": "10-K", "baseForm": "10-K", "isAmendment": false,
  "filingDate": "2026-11-03", "reportDate": "2026-09-26",
  "acceptedAt": "2026-11-03T13:05:15.000Z", "act": "34",
  "fileNumber": "001-36743", "filmNumber": "261514222",
  "items": [], "sizeBytes": 10902198, "isXbrl": true, "isInlineXbrl": true,
  "primaryDocument": "aapl-20260926.htm", "description": "10-K",
  "links": {
    "document":   "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm",
    "index":      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm",
    "folderJson": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/index.json",
    "inlineXbrlViewer": "https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm",
    "rawXml": null
  }
}
```

## Endpoint contracts

```ts
// src/routes/filings/contract.ts
export const FilingSort = z.enum(['filingDate', '-filingDate']);   // "-" = descending

export const FilingListInput = PaginationQuery.extend({
  ticker: Ticker,                                      // path
  form: TrackedForm.optional(),                        // filter, matches baseForm
  sort: FilingSort.default('-filingDate'),
});
export const FilingListOutput = z.strictObject({
  company: Company,
  filings: pageOf(Filing),
});

export const SummaryInput = PaginationQuery.extend({ form: TrackedForm.optional() });
export const CompanySummary = z.strictObject({
  cik: z.number().int(),
  ticker: z.string(),
  name: z.string(),
  counts: z.strictObject({ '10-K': z.number(), '10-Q': z.number(), '8-K': z.number(), total: z.number() }),
  latest10K: z.strictObject({ filingDate: z.string(), links: FilingLinks }).nullable(),
  filingsSyncedAt: z.string().nullable(),
});
export const SummaryOutput = pageOf(CompanySummary);
```

```ts
// src/routes/companies/contract.ts
export const CompanyListInput = PaginationQuery.extend({
  q: z.string().trim()
    .min(1)
    .max(100)
    .optional(),     // ticker prefix or name contains
  selected: booleanOrText.optional(),
});
export const CompanyListOutput = pageOf(Company);

export const CompanyUpdateInput = z.strictObject({
  ticker: Ticker,                                      // path
  selected: z.boolean(),                               // body, required
});
export const CompanyUpdateOutput = Company;
```

## Code snippets / parsing algorithms

### Columns to rows

The arrays must all be the same length. If they differ, the data is corrupt, so the function
fails loudly instead of zipping misaligned values.

```ts
type Columns = z.infer<typeof FilingColumns>;
type RawRow = { [K in keyof Columns]: Columns[K][number] };

export function columnsToRows(cols: Columns): RawRow[] {
  const keys = Object.keys(cols) as (keyof Columns)[];
  const length = cols.accessionNumber.length;
  const bad = keys.filter((k) => cols[k].length !== length);
  if (bad.length > 0) throw new Error(`EDGAR columns misaligned: ${bad.join(', ')}`);
  return Array.from({ length }, (_, i) => Object.fromEntries(keys.map((k) => [k, cols[k][i]])) as RawRow);
}
```

### Last-year cut

```ts
export const RETENTION_DAYS = 365;

export function withinRetention(rows: RawRow[], now: Date): RawRow[] {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()
    .slice(0, 10);
  return rows.filter((r) => r.filingDate >= cutoff);   // YYYY-MM-DD compares as text
}
```

### Link builder

```ts
const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const XSL_PREFIX = /^xsl[^/]+\//;

export function buildLinks(cik: number, accession: string, primaryDocument: string, isInlineXbrl: boolean) {
  const folder = `${ARCHIVES}/${cik}/${accession.replaceAll('-', '')}`;
  const docPath = `/Archives/edgar/data/${cik}/${accession.replaceAll('-', '')}/${primaryDocument}`;
  return {
    document: `${folder}/${primaryDocument}`,
    index: `${folder}/${accession}-index.htm`,
    folderJson: `${folder}/index.json`,
    inlineXbrlViewer: isInlineXbrl
      ? `https://www.sec.gov/ix?doc=${docPath}`
      : null,
    rawXml: XSL_PREFIX.test(primaryDocument)
      ? `${folder}/${primaryDocument.replace(XSL_PREFIX, '')}`
      : null,
  };
}
```

### Form split

The filter is three forms, and the summary counts by those three, so there is no category map.
`10-K/A` matches the `10-K` filter and carries `isAmendment: true`.

```ts
export function splitForm(form: string) {
  const isAmendment = form.endsWith('/A');
  return { baseForm: isAmendment
    ? form.slice(0, -2)
    : form, isAmendment };
}
```

### Row to `Filing`

```ts
const emptyToNull = (s: string) => (s === ''
  ? null
  : s);

export function toFiling(cik: number, r: RawRow): Filing {
  const isInlineXbrl = r.isInlineXBRL === 1;
  return Filing.parse({
    accessionNumber: r.accessionNumber,
    cik,
    form: r.form,
    ...splitForm(r.form),
    filingDate: r.filingDate,
    reportDate: emptyToNull(r.reportDate),
    acceptedAt: r.acceptanceDateTime,
    act: emptyToNull(r.act),
    fileNumber: emptyToNull(r.fileNumber),
    filmNumber: emptyToNull(r.filmNumber),
    items: r.items === ''
      ? []
      : r.items.split(','),
    sizeBytes: r.size,
    isXbrl: r.isXBRL === 1,
    isInlineXbrl,
    primaryDocument: r.primaryDocument,
    description: emptyToNull(r.primaryDocDescription),
    links: buildLinks(cik, r.accessionNumber, r.primaryDocument, isInlineXbrl),
  });
}
```

### Ingest flow (one company)

```
GET /companies/:ticker/filings
→ company_tickers: ticker → cik           (404 if unknown)
→ filingsSyncedAt older than SYNC_TTL_HOURS (24) or null?
   → no: read from DB
   → yes: GET data.sec.gov/submissions/CIK{cik10}.json  (SEC_USER_AGENT, ≤10 req/s)
          → parse SubmissionsHeader (loose)
          → update company header fields, filingsSyncedAt = now
          → withinRetention(columnsToRows(recent)).map(toFiling)
          → insert ON CONFLICT(accession_number) DO NOTHING
          → delete filings older than the cutoff for this cik
→ query filings: cik, optional base_form, sort, page
→ { company, filings }
```

An insert keyed on `accessionNumber` makes a re-sync safe: running it twice inserts nothing new.
`PATCH /companies/:ticker` with `selected: true` runs the same sync before answering.
`GET /filings/summary` reads the DB only and never calls SEC. An SEC failure (403 for a missing
User-Agent, 404, 429, network) answers 502 with the SEC status; when stale rows exist, they are
served instead, and `filingsSyncedAt` shows their age.

---

## DB tables

Add them with `/db add companies`, `/db add company_tickers` and `/db add filings`. That skill
writes `src/data/sqlite/tables/<area>.ts` and the `pg` twin. The repositories go in
`src/data/repositories/companies.ts` and `filings.ts`. Shape:

- `companies`: `cik` int PK, `cik10` text unique, `ticker` text, `name`, `selected` bool default
  false, `exchanges` (JSON text), `sic`, `sic_description`, `category`, `fiscal_year_end`,
  `filings_synced_at`. Index `(name)` for the alphabetical list, and `(selected)`.
- `company_tickers`: `ticker` text PK, `cik` int FK.
- `filings`: `accession_number` text PK, `cik` int FK, `form`, `base_form`, `is_amendment`,
  `filing_date`, `report_date`, `accepted_at`, `act`, `file_number`, `film_number`, `items`
  (JSON text), `size_bytes`, `is_xbrl`, `is_inline_xbrl`, `primary_document`, `description`, and
  the five link columns.
- Index `filings(cik, filing_date DESC)` serves the paginated list. Index `filings(cik, base_form)`
  serves the filter and the summary.

The links could be rebuilt on every read instead of stored. They are stored because the list
endpoint and the MCP tool then return them with no extra work, and they never change for an
accession.

### Seed

`src/data/seeds/01-companies.ts` reads `src/data/seeds/data/company_tickers.json` and validates
it with `TickerFile`. It inserts one company per CIK, with the first ticker in the file as the
primary, and every ticker into `company_tickers`. Inserts go in chunks of 500 with
`onConflictDoNothing`, because the seed runner runs every seed on every `db:seed`.

## Edge cases for test suite

- `reportDate`, `items`, `act`, `primaryDocDescription` are `""`. Each becomes `null` or `[]`.
- An accession prefix that belongs to a filing agent (`0001140361-…`). The link still uses the
  company CIK.
- An `xsl…/` primary document gives `rawXml` a value. A plain `.htm` gives `null`.
- `core_type` is `"XBRL"` for 10-K/10-Q/8-K/DEF 14A. It is ignored, and only `form` counts.
- A `.pdf` primary document (`UPLOAD` → `filename1.pdf`) still links correctly.
- Column arrays of different lengths make the ingest throw.
- The ticker file's `cik_str` is a number, and the submissions file's `cik` is a padded string.
  Both are normalized to the integer `cik`.
- A secondary ticker (`AEMRF`) resolves to the same company as `AEM` (CIK 2809).
- `10-K/A` appears under the `10-K` filter with `isAmendment: true`.
- A company with no 10-K in the last year gets `latest10K: null`.
- A second sync within the TTL makes no SEC request.
- The page past the last one returns `items: []` with the real `total`.

## DoD verification

1. Unit tests for `columnsToRows`, `withinRetention`, `buildLinks`, `splitForm`, `toFiling`,
   using a small fixture cut from the Apple submissions file (5 rows: 10-K, 8-K, Form 4, 424B2,
   UPLOAD).
2. A contract test on `tests/fixtures/sec/aapl-submissions.json` (a copy of
   `.tmp/APPL-CIK0000320193.json`): 1001 rows parse with 0 failures. With `now = 2026-11-11`,
   the last-year cut keeps 94 rows: 1 × 10-K, 3 × 10-Q, 9 × 8-K.
3. A live probe, off unless `SEC_LIVE=1`, sends `HEAD` to three built links and expects 200.
4. The gates: `bun run lint`, `typecheck`, `typecheck:pg`, `bun test`, `privacy`.
