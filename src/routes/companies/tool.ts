import { inDomain } from '../../logging.ts';
import { defineTool, type ToolDefinition } from '../../mcp/register.ts';
import { syncSourcesFor } from '../filings/repository.ts';

import { CompanyListInput, CompanyUpdateInput, DOMAIN } from './contract.ts';
import { listCompanies } from './list.flow.ts';
import { companyStore } from './repository.ts';
import { updateCompany } from './update.flow.ts';

/**
 * Lists one page of companies. Its HTTP twin, `GET /api/companies` in
 * `src/routes/companies/http.ts`, parses with the very same `CompanyListInput` object. It binds
 * the `Companies` domain on the call's log and hands it to the flow, and logs nothing itself.
 */
export const companyListTool: ToolDefinition = defineTool({
  name: 'company_list',
  title: 'List companies',
  description:
    'Returns one page of the companies the service tracks, with the total across every page. ' +
    '`q` matches a ticker prefix or a name it contains, `selected` keeps only the companies in ' +
    'or out of the summary, and `page` and `pageSize` choose the page.',
  input: CompanyListInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: async (input, { db, log }) => listCompanies(input, { store: companyStore(db), log: inDomain(log, DOMAIN) }),
});

/**
 * Sets whether one company is in the summary. Its HTTP twin, `PATCH /api/companies/:ticker` in
 * `src/routes/companies/http.ts`, parses with the very same `CompanyUpdateInput` object. It binds
 * the `Companies` domain on the call's log and hands it to the flow, and logs nothing itself.
 */
export const companyUpdateTool: ToolDefinition = defineTool({
  name: 'company_update',
  title: 'Update a company',
  description:
    'Sets whether the company with `ticker` is in the summary, from the required `selected` ' +
    'flag, and returns the company. It sets the flag as given and never toggles it, so a repeat ' +
    'call changes nothing. Fails when no company trades under the ticker.',
  input: CompanyUpdateInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  run: async (input, { db, log, sec }) => updateCompany(input, { store: companyStore(db), sync: syncSourcesFor(db, sec), log: inDomain(log, DOMAIN) }),
});

/** The companies tools, in the order of their routes in `companyRoutes`. */
export const companyTools: readonly ToolDefinition[] = [companyListTool, companyUpdateTool];
