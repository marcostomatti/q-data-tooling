import { inDomain } from '../../logging.ts';
import { defineTool, type ToolDefinition } from '../../mcp/register.ts';

import { DOMAIN, FilingListInput, SummaryInput } from './contract.ts';
import { listFilings } from './list.flow.ts';
import { companyLookupStore, filingStore, syncSourcesFor } from './repository.ts';
import { summarizeFilings } from './summary.flow.ts';

/**
 * Lists one company's filings. Its HTTP twin, `GET /api/companies/:ticker/filings` in
 * `src/routes/filings/http.ts`, parses with the very same `FilingListInput` object. It binds the
 * `Filings` domain on the call's log and hands it to the flow, and logs nothing itself.
 */
export const filingListTool: ToolDefinition = defineTool({
  name: 'filing_list',
  title: 'List filings',
  description:
    'Returns the company with `ticker` and one page of its filings of the last year, every form, ' +
    'each with its SEC links, and the total across every page. `form` keeps one bucket: a named ' +
    'base form (10-K, 10-Q, 8-K, 6-K, 4 or 144), amendments included, or `other` for every other ' +
    'form. `sort` orders by filing date (`-filingDate`, newest first, by default), and `page` and ' +
    '`pageSize` choose the page. Fails when no company trades under the ticker.',
  input: FilingListInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (input, { db, log, sec }) => listFilings(input, {
    companies: companyLookupStore(db),
    filings: filingStore(db),
    sync: syncSourcesFor(db, sec),
    log: inDomain(log, DOMAIN),
  }),
});

/**
 * Summarizes the filings of the companies in the summary. Its HTTP twin, `GET /api/filings/summary`
 * in `src/routes/filings/http.ts`, parses with the very same `SummaryInput` object. It binds the
 * `Filings` domain on the call's log and hands it to the flow, and logs nothing itself.
 */
export const filingSummaryTool: ToolDefinition = defineTool({
  name: 'filing_summary',
  title: 'Summarize filings',
  description:
    'Returns one page of the companies in the summary, with the total across every page. Each ' +
    'carries its name, ticker and CIK, its count of filings per bucket (10-K, 10-Q, 8-K, 6-K, 4, ' +
    '144, and `other` for every other form) and in total, the date of its newest filing in each ' +
    'bucket, the date and links of its latest 10-K, and when its filings were last synced. ' +
    '`form` narrows it to one bucket, and `page` and `pageSize` choose the page.',
  input: SummaryInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (input, { db, log }) => summarizeFilings(input, { filings: filingStore(db), log: inDomain(log, DOMAIN) }),
});

/** The filings tools, in the order of their routes in `filingRoutes`. */
export const filingTools: readonly ToolDefinition[] = [filingListTool, filingSummaryTool];
