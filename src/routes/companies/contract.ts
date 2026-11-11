import { z } from 'zod';

import { Company } from '../../entities/company.ts';
import { booleanOrText, pageOf, PaginationQuery, Ticker } from '../common.ts';

/** The domain every line of `company_list` and `company_update` carries, bound by both transport files. */
export const DOMAIN = 'Companies';

/**
 * The input of `company_list`, `GET /companies`: the paging fields, `q` to match a ticker
 * prefix or a name it contains, 1 to 100 characters once trimmed, and `selected` to keep only
 * the companies in the summary or only those out of it. Strict, so a stray field is refused.
 */
export const CompanyListInput = PaginationQuery.extend({
  /** A ticker prefix or a part of the name to match, 1 to 100 characters once trimmed. */
  q: z.string().trim()
    .min(1)
    .max(100)
    .optional(),
  /** Keep only the companies in the summary when `true`, or only those out of it when `false`. */
  selected: booleanOrText.optional(),
});

/** The parsed input of `company_list`, as {@link CompanyListInput} reads it. */
export type CompanyListInput = z.infer<typeof CompanyListInput>;

/** What `company_list` answers: one page of companies and the total across every page. */
export const CompanyListOutput = pageOf(Company);

/** One page of companies, as {@link CompanyListOutput} parses it. */
export type CompanyListOutput = z.infer<typeof CompanyListOutput>;

/**
 * The input of `company_update`, `PATCH /companies/:ticker`: the ticker from the path, upper
 * cased, and the required `selected` flag from the body, which sets the company in or out of the
 * summary rather than toggling it. Strict, so a stray field is refused.
 */
export const CompanyUpdateInput = z.strictObject({
  /** The ticker from the path, upper cased. */
  ticker: Ticker,
  /** Whether the company is in the summary, set as given and never toggled. */
  selected: z.boolean(),
});

/** The parsed input of `company_update`, as {@link CompanyUpdateInput} reads it. */
export type CompanyUpdateInput = z.infer<typeof CompanyUpdateInput>;

/** What `company_update` answers: the company as it stands after the change. */
export const CompanyUpdateOutput = Company;

/** The changed company, as {@link CompanyUpdateOutput} parses it. */
export type CompanyUpdateOutput = z.infer<typeof CompanyUpdateOutput>;
