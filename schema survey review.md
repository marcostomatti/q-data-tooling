# Schema survey

Tech assessment: a small API that lists a company's SEC filings and links to their documents.
Research so far is in @NOTES.md. API reference:
<https://www.sec.gov/search-filings/edgar-application-programming-interfaces>

**Do not scan `./.tmp`.** It is large. Read only the files named here.

## Inputs

- Ticker entry, from the full company list:
  `{ "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." }`
- Submissions example: `.tmp/APPL-CIK0000320193.json`

## Do

1. Describe the schema of the submissions document.
2. Confirm the link template from each filing to its original document on sec.gov.
3. Give example algorithms to parse the submissions blob, find the filings, and match each form
   type to its link. Documents are linked, never downloaded.
4. Propose a row-shaped filing record, easier than EDGAR's columns, for DB ingest and for the
   frontend links.

## Rules

- No code, no file changes. Snippets and sample schemas only, for `setup-prompt.md`.
- Ask when in doubt.
