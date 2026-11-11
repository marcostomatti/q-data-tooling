import type { RouteSpec } from '../../http/route.ts';

import { route } from '../../http/route.ts';
import { inDomain } from '../../logging.ts';
import { syncSourcesFor } from '../filings/repository.ts';

import { CompanyListInput, CompanyListOutput, CompanyUpdateInput, CompanyUpdateOutput, DOMAIN } from './contract.ts';
import { listCompanies } from './list.flow.ts';
import { companyStore } from './repository.ts';
import { updateCompany } from './update.flow.ts';

/**
 * `GET /api/companies`, the HTTP twin of the `company_list` tool: the same schema object and the
 * same flow, answered as `{ success: true, data: CompanyListOutput }`. It binds the `Companies`
 * domain on the request's log and hands it to the flow, and logs nothing itself.
 */
export const companyListRoute = route('get', '/companies', 'company_list', CompanyListInput, {
  summary: 'Lists one page of companies, matched by ticker prefix or name with q and filtered by selected.',
  output: CompanyListOutput,
}, async (input, { db, log }) => listCompanies(input, { store: companyStore(db), log: inDomain(log, DOMAIN) }));

/**
 * `PATCH /api/companies/:ticker`, the HTTP twin of the `company_update` tool: the ticker from the
 * path and the required `selected` from the body, answered as `{ success: true, data: Company }`,
 * or a 404 when no company trades under the ticker. It binds the `Companies` domain on the
 * request's log and hands it to the flow, and logs nothing itself.
 */
export const companyUpdateRoute = route('patch', '/companies/:ticker', 'company_update', CompanyUpdateInput, {
  summary: 'Sets whether the company with the ticker is in the summary, from the required selected flag.',
  output: CompanyUpdateOutput,
}, async (input, { db, log, sec }) => updateCompany(input, { store: companyStore(db), sync: syncSourcesFor(db, sec), log: inDomain(log, DOMAIN) }));

/** The companies routes, in the order `ROUTES` lists them. */
export const companyRoutes: readonly RouteSpec[] = [companyListRoute, companyUpdateRoute];
