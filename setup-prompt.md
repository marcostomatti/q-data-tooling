## Overview
I'm starting a tech assessment, the goal is that based on a Company ticker we will provide search and fetch functionality for company summaries and submitted objects. 
For this repo we're using @open-tomato/template-service that bootstraps with express, db support via drizzle, our service core features and some extra addons. There's are skills available for specific scaffolding tasks, listed in @CLAUDE.md. 

Below is the job to be done as well as some snippets and schemas prepared before to be used as templates for the code generation.

## My Tasks
1. Filings: fetch their submissions (Company's filing history) from EDGAR submissions API. The fetch logic will use the company's given ticker. 
  - URI:  `[GET] /companies/{:ticker}/filings` 
  - Params: 
    - @path ticker(string).
    - @param filter(enum "10-K", "10-Q", "8-K")
    - @param PaginationControls
    - @param sort(filingDate)
  - handler: 
    1. Fetches company by ticker, I use CIK to define CIK10 and keep in the context
    2. Convert the response data structure to our data schema and filter out old data. 
    3. We fetch the company fillings and store the last year in the db. 
    4. Response is sent with the company details and fillings link to original document.
2. Summary: Given a set of companies (Task 3) we return the each companies basic data (name, ticker, cik) and their fillings per form type. Last date of a 10-K is included as it's own data point.
    - URI:  `[GET] /filings/summary`
    - Params: 
      - (optional) @param filter(enum "10-K", "10-Q", "8-K")
      - (optional) @param PaginationControls

3. Companies: We retrieve the list of all companies: we list all, paginated. For a subset on the quick switch we the summary query already giving the favorites. Then we expose an PATCH resource verb/method for inclduing/removing a company from the summary list, technically is just swapping the `selected`, I'm not sure it even requires a body or extra param. 
  - Fetch all:  
    - URI: `[GET] /companies`
    - Params: 
      - (optional) @param PaginationControls
   - handler:
    1. Fetches all companies (limited by pagination) alphabetically.
  - Update selected by ticker:
    - `[PATCH] /companies/{:ticker}`
    - body:
      - (optional) @param selected(boolean)

## Your Tasks
  - **DO NOT** write the endpoint internal logic.
  - **DO** Write tests and validation checks without covering internal logic, these will act as task assessment against my implementation. As I move through the tasks I'll write additional tests.
    - Validate input schema.
    - Validate response schema.
    - Validate OpenApi spec. 
  - Bootstrap the endpoints with the [schemas proposed below](#data-schemas) and shallow tests checking validation and response flow is valid. Include the OpenAPI based in our schema and the extended endpoint schema for filter/pagination features. 

## Known data and APIs:
- `CIK `is a number, in some requests is used with leading `0`s, we will call that `CIK10` internally to differentiate if it has been fixed or not.
- we have a [json file][.tmp/company_tickers.json] (stay away of other files in that directory, they are submissions and other api responses examples from the sec.gov apis and some are excesively big) we are using for seeding the company db with the ticker and CIK, we will use this data to populate a search component that will handle the pairing outside the backend logic, we will receive both in the request payload. 
- EDGAR submissions API: `data.sec.gov/submissions/{:CIK10}.json`

### Link templates
| Link                 | Template                                                                              | When                                |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| Primary document     | `https://www.sec.gov/Archives/edgar/data/{cik}/{accNoDash}/{primaryDocument}`         | always                              |
| Filing index (human) | `https://www.sec.gov/Archives/edgar/data/{cik}/{accNoDash}/{accession}-index.htm`     | always                              |
| Filing folder (JSON) | `https://www.sec.gov/Archives/edgar/data/{cik}/{accNoDash}/index.json`                | always                              |
| Inline XBRL viewer   | `https://www.sec.gov/ix?doc=/Archives/edgar/data/{cik}/{accNoDash}/{primaryDocument}` | `isInlineXBRL === 1`                |
| Raw XML              | same as primary, with the leading `xsl…/` segment removed                             | `primaryDocument` starts with `xsl` |
| Submissions          | `https://data.sec.gov/submissions/CIK{cik10}.json`                                    | per company                         |
| Overflow             | `https://data.sec.gov/submissions/{files[i].name}`                                    | older history                       |

## Front end
Based and updated from the original @NOTES.md for Front end definitions. More details of the site's 2 pages in this project. Use `@open-tomato/components` as core UI library, then use `@open-tomato/charts` for the summary dashboard elements, follow the package skills and agents. 
- Summary: 
  - Top row of 3 `SmallStatCard` compact showing basic stats of total of submissions by the selected companies, avg per company, latest submission.
  - Table with companies in the summary. Each row:
    - `Badge` with ticker
    - Company name as a `ghost` variant `Button` to open fillings modal for that specific company.
    - 1 row per form 
    - `Remove` button on the last column to remove from the summary, this one triggers a `ConfirmPopover`.
- Companies: 
  - Show control bar for search and filter over the results, add pagination controls.
  - Each company in a `RowStatCard` based on the the stats only example (`/story/molecules-rowstatcard--stats-only`) from the package stories.
    - Name as a `ghost` variant `Button` to open fillings modal for that specific company.
    - `Switch` on the right for selecting the company to be included in the summary. I can't remember if the component allows this, otherwise explore `DecoratedToggle` if a `ghost` variant `Button` is supported in the title and it doesn't conflicts with the touchable event. Fallback to the same table of the summary otherwise with a toggle column.
- Fillings (as modal or drawer, add a toggle before deciding):
  - 

## Data schemas

### Tickers
keys are "0", "1", ...; the values are what matter
```ts
const TickerEntry = z.object({
  cik_str: z.number().int(),   // raw CIK, no padding: 320193
  ticker: z.string(),          // "AAPL"
  title: z.string(),           // "Apple Inc."
});
const TickerFile = z.record(z.string(), TickerEntry);
```

### Submissions document: company header
The schema is loose on purpose (`.passthrough()` or no `.strict()`), because EDGAR adds fields without notice. Only the contracts we write ourselves are strict.
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
shared by `filings.recent` and every overflow file.

The segment `recent` holds at most about the last 1000 filings, or one year of them. Older filings are in `files[]`. Each overflow file is fetched from `https://data.sec.gov/submissions/{name}`, and its body is a `FilingColumns` object at the top level, with no `filings.recent` around it.

```ts
const FilingColumns = z.object({
  accessionNumber:       z.array(z.string()),   // "0000320193-26-000026"
  filingDate:            z.array(z.string()),   // "YYYY-MM-DD"
  reportDate:            z.array(z.string()),   // "YYYY-MM-DD" or ""  (225/1001 empty)
  acceptanceDateTime:    z.array(z.string()),   // ISO, "2026-11-09T22:00:55.000Z"
  act:                   z.array(z.string()),   // "33" | "34" | ""
  form:                  z.array(z.string()),   // "10-K", "8-K", "4", "SC 13G/A", ...
  fileNumber:            z.array(z.string()),
  filmNumber:            z.array(z.string()),
  items:                 z.array(z.string()),   // "8.01,9.01" or ""  (8-K items)
  core_type:             z.array(z.string()),   // "XBRL" for financial filings, else ≈ form
  size:                  z.array(z.number()),   // bytes
  isXBRL:                z.array(z.number()),   // 0 | 1
  isInlineXBRL:          z.array(z.number()),   // 0 | 1
  isXBRLNumeric:         z.array(z.number()),   // 0 | 1
  primaryDocument:       z.array(z.string()),   // "aapl-20260926.htm" | "xslF345X06/form4.xml"
  primaryDocDescription: z.array(z.string()),   // often ""
});

const OverflowFileRef = z.object({
  name: z.string(),          // "CIK0000320193-submissions-001.json"
  filingCount: z.number(),
  filingFrom: z.string(),
  filingTo: z.string(),
});
```

## Data normalization:
There is one row per filing. Empty strings become 'null', '0'/'1' become booleans, 'items' is split into an array, and the links are built once, at ingest.

```ts
export const FormCategory = z.enum([
  'annual', 'quarterly', 'current', 'insider', 'ownership',
  'proxy', 'registration', 'correspondence', 'other',
]);

export const FilingLinks = z.object({
  document: z.string().url(),
  index: z.string().url(),
  folderJson: z.string().url(),
  inlineXbrlViewer: z.string().url().nullable(),
  rawXml: z.string().url().nullable(),
}).strict();

export const Filing = z.object({
  accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),  // primary key
  cik: z.number().int(),                                      // FK → companies
  form: z.string(),                                           // "10-K/A" kept verbatim
  baseForm: z.string(),                                       // "10-K" (no "/A")
  isAmendment: z.boolean(),
  category: FormCategory,
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

export const Company = z.object({
  cik: z.number().int(),          // primary key, unpadded
  cik10: z.string().length(10),
  name: z.string(),
  tickers: z.array(z.string()),
  exchanges: z.array(z.string()),
  sic: z.string().nullable(),
  sicDescription: z.string().nullable(),
  category: z.string().nullable(),
  fiscalYearEnd: z.string().nullable(),   // "MMDD"
  stateOfIncorporation: z.string().nullable(),
  filingsSyncedAt: z.string().nullable(), // when submissions were last pulled
  historyComplete: z.boolean(),           // overflow files ingested?
}).strict();
```

### example response data:
```ts
{
  "accessionNumber": "0000320193-26-000026",
  "cik": 320193,
  "form": "10-K", "baseForm": "10-K", "isAmendment": false, "category": "annual",
  "filingDate": "2026-11-03", "reportDate": "2026-09-26",
  "acceptedAt": "2026-11-03T…Z", "act": "34",
  "items": [], "sizeBytes": 0, "isXbrl": true, "isInlineXbrl": true,
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

## Code snippets / parsing algorythms


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
    inlineXbrlViewer: isInlineXbrl ? `https://www.sec.gov/ix?doc=${docPath}` : null,
    rawXml: XSL_PREFIX.test(primaryDocument)
      ? `${folder}/${primaryDocument.replace(XSL_PREFIX, '')}` : null,
  };
}
```

### Form category map

The form is matched after the `/A` suffix is removed, so `8-K/A` lands in `current`. Prefix
rules catch families such as `S-3ASR`, `S-8 POS`, `424B2`.

```ts
const EXACT: Record<string, FormCategory> = {
  '10-K': 'annual', '20-F': 'annual', '40-F': 'annual', '10-KT': 'annual',
  '10-Q': 'quarterly',
  '8-K': 'current', '6-K': 'current',
  '3': 'insider', '4': 'insider', '5': 'insider', '144': 'insider',
  'DEF 14A': 'proxy', 'DEFA14A': 'proxy', 'PX14A6G': 'proxy', 'PX14A6N': 'proxy',
  'FWP': 'registration', '8-A12B': 'registration', '25': 'registration', '25-NSE': 'registration',
  'CORRESP': 'correspondence', 'UPLOAD': 'correspondence', 'NO ACT': 'correspondence',
};
const PREFIX: [string, FormCategory][] = [
  ['SC 13', 'ownership'], ['SCHEDULE 13', 'ownership'],
  ['S-', 'registration'], ['424B', 'registration'], ['DEF', 'proxy'],
];

export function categorize(form: string) {
  const isAmendment = form.endsWith('/A');
  const baseForm = isAmendment ? form.slice(0, -2) : form;
  const category = EXACT[baseForm]
    ?? PREFIX.find(([p]) => baseForm.startsWith(p))?.[1]
    ?? 'other';
  return { baseForm, isAmendment, category };
}
```

### Row to `Filing`

```ts
const emptyToNull = (s: string) => (s === '' ? null : s);

export function toFiling(cik: number, r: RawRow): Filing {
  const isInlineXbrl = r.isInlineXBRL === 1;
  return Filing.parse({
    accessionNumber: r.accessionNumber,
    cik,
    form: r.form,
    ...categorize(r.form),
    filingDate: r.filingDate,
    reportDate: emptyToNull(r.reportDate),
    acceptedAt: r.acceptanceDateTime,
    act: emptyToNull(r.act),
    fileNumber: emptyToNull(r.fileNumber),
    filmNumber: emptyToNull(r.filmNumber),
    items: r.items === '' ? [] : r.items.split(','),
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
GET data.sec.gov/submissions/CIK{cik10}.json   (User-Agent set, ≤10 req/s)
→ parse SubmissionsHeader
→ upsert Company (cik = Number(header.cik), filingsSyncedAt = now)
→ columnsToRows(header.filings.recent).map(toFiling)
→ upsert filings ON CONFLICT(accessionNumber) DO NOTHING
→ history requested and files[] not empty?
   → no: done (historyComplete = files.length === 0)
   → yes: for each file → GET, columnsToRows, toFiling, upsert → historyComplete = true
```

An upsert keyed on `accessionNumber` makes a re-sync safe: running it twice inserts nothing new.

---

## DB tables

Add them with `/db add companies` and `/db add filings`. That skill writes
`src/data/sqlite/tables/<area>.ts` and the `pg` twin. The repositories go in
`src/data/repositories/companies.ts` and `filings.ts`. Shape:

- `companies`: `cik` int PK, `cik10` text unique, `name`, `tickers` (JSON text), `sic`,
  `sic_description`, `category`, `fiscal_year_end`, `filings_synced_at`, `history_complete`.
- `filings`: `accession_number` text PK, `cik` int FK, `form`, `base_form`, `is_amendment`,
  `category`, `filing_date`, `report_date`, `accepted_at`, `act`, `items` (JSON text),
  `size_bytes`, `is_xbrl`, `is_inline_xbrl`, `primary_document`, `description`, and the five
  link columns.
- Index `filings(cik, filing_date DESC)` serves the paginated list. Index
  `filings(cik, category)` and `filings(cik, base_form)` serve the filters and the summary.

The links could be rebuilt on every read instead of stored. They are stored because the list
endpoint and the MCP tool then return them with no extra work, and they never change for an
accession.

## Edge cases for test suite
- `reportDate`, `items`, `act`, `primaryDocDescription` are `""`. Each becomes `null` or `[]`.
- An accession prefix that belongs to a filing agent (`0001140361-…`). The link still uses the
  company CIK.
- An `xsl…/` primary document gives `rawXml` a value. A plain `.htm` gives `null`.
- `core_type` is `"XBRL"` for 10-K/10-Q/8-K/DEF 14A. It is ignored for categorizing, and only
  `form` counts.
- A `.pdf` primary document (`UPLOAD` → `filename1.pdf`) still links correctly.
- Column arrays of different lengths make the ingest throw.
- The ticker file's `cik_str` is a number, and the submissions file's `cik` is a padded string.
  Both are normalized to the integer `cik`.

## DoD verification
1. Unit tests for `columnsToRows`, `buildLinks`, `categorize`, `toFiling`, using a small fixture
   cut from `.tmp/APPL-CIK0000320193.json` (5 rows: 10-K, 8-K, Form 4, 424B2, UPLOAD).
2. A contract test checks that the full Apple file parses: 1001 rows, 0 failures, and the form
   counts above (595 Form 4, 102 8-K, 12 10-K, 33 10-Q).
3. A live probe, env-gated and off by default, sends `HEAD` to three built links and expects 200.
   These are the same probes this plan ran by hand.
4. The gates: `bun run lint`, `typecheck`, `typecheck:pg`, `bun test`, `privacy`.
