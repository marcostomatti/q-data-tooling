import type { RouteSpec } from '../../http/route.ts';

import { route } from '../../http/route.ts';
import { inDomain } from '../../logging.ts';

import { DOMAIN, FilingListInput, FilingListOutput, SummaryInput, SummaryOutput } from './contract.ts';
import { listFilings } from './list.flow.ts';
import { companyLookupStore, filingStore, syncSourcesFor } from './repository.ts';
import { summarizeFilings } from './summary.flow.ts';

/**
 * `GET /api/companies/:ticker/filings`, the HTTP twin of the `filing_list` tool: the same schema
 * object and the same flow, answered as `{ success: true, data: FilingListOutput }`, or a 404
 * when no company trades under the ticker. It binds the `Filings` domain on the request's log
 * and hands it to the flow, and logs nothing itself.
 */
export const filingListRoute = route('get', '/companies/:ticker/filings', 'filing_list', FilingListInput, {
  summary: 'Lists the company with the ticker and one page of its filings, filtered by base form or `other` and sorted by filing date.',
  output: FilingListOutput,
}, async (input, { db, log, sec }) => listFilings(input, {
  companies: companyLookupStore(db),
  filings: filingStore(db),
  sync: syncSourcesFor(db, sec),
  log: inDomain(log, DOMAIN),
}));

/**
 * `GET /api/filings/summary`, the HTTP twin of the `filing_summary` tool: the same schema object
 * and the same flow, answered as `{ success: true, data: SummaryOutput }`. It binds the
 * `Filings` domain on the request's log and hands it to the flow, and logs nothing itself.
 */
export const filingSummaryRoute = route('get', '/filings/summary', 'filing_summary', SummaryInput, {
  summary: 'Lists one page of the companies in the summary, each with its filing counts and newest filing date per form, `other` included, and its latest 10-K.',
  output: SummaryOutput,
}, async (input, { db, log }) => summarizeFilings(input, { filings: filingStore(db), log: inDomain(log, DOMAIN) }));

/** The filings routes, in the order `ROUTES` lists them. */
export const filingRoutes: readonly RouteSpec[] = [filingListRoute, filingSummaryRoute];
