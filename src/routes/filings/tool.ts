import { inDomain } from '../../logging.ts';
import { defineTool, type ToolDefinition } from '../../mcp/register.ts';

import { DOMAIN, FilingListInput, SummaryInput } from './contract.ts';
import { listFilings } from './list.flow.ts';
import { companyLookupStubStore, filingStubStore } from './stub.ts';
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
    'Returns the company with `ticker` and one page of its 10-K, 10-Q and 8-K filings of the ' +
    'last year, each with its SEC links, and the total across every page. `form` keeps one base ' +
    'form, amendments included, `sort` orders by filing date (`-filingDate`, newest first, by ' +
    'default), and `page` and `pageSize` choose the page. Fails when no company trades under the ticker.',
  input: FilingListInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (input, { log }) => listFilings(input, { companies: companyLookupStubStore, filings: filingStubStore, log: inDomain(log, DOMAIN) }),
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
    'carries its name, ticker and CIK, its count of 10-K, 10-Q and 8-K filings and in total, the ' +
    'date and links of its latest 10-K, and when its filings were last synced. `form` narrows it ' +
    'to one base form, and `page` and `pageSize` choose the page.',
  input: SummaryInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (input, { log }) => summarizeFilings(input, { filings: filingStubStore, log: inDomain(log, DOMAIN) }),
});

/** The filings tools, in the order of their routes in `filingRoutes`. */
export const filingTools: readonly ToolDefinition[] = [filingListTool, filingSummaryTool];
