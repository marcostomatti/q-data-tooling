import type { FormBucket } from '../../../entities/filing.ts';
import type { Company } from '../../api.ts';
import type { FilingsApi, FilingsResult } from '../../components/filings/logic.ts';
import type { SelectionItem } from '@open-tomato/components';

import { companies, filings } from '../../api.ts';
import { FORM_BUCKETS, FORM_LABELS, loadFilings } from '../../components/filings/logic.ts';

/** The Filings page's nav label, which the shell's topbar shows as the page's title. */
export const FILINGS_TITLE = 'Filings';

/** The Filings page's path; a company's filings are at this path, a slash, then its CIK. */
export const FILINGS_PATH = '/filings';

/** What the empty state says while no company is picked. */
export const NOTHING_TITLE = 'Nothing to show';

/** What the empty state tells the reader to do to see filings. */
export const NOTHING_DESCRIPTION = 'Search for a company by CIK, ticker or name to see their filings.';

/** A CIK in the path: digits only, leading zeros or not. */
const CIK_SEGMENT = /^\/filings\/(\d+)$/;

/**
 * The CIK a Filings path names: `/filings/320193` and `/filings/0000320193` both name Apple's.
 *
 * @param path - The browser's path.
 * @returns The CIK, or `undefined` for `/filings` itself or any segment that is not digits only.
 */
export function cikFromPath(path: string): number | undefined {
  const digits = CIK_SEGMENT.exec(path)?.[1];
  return digits === undefined
    ? undefined
    : Number(digits);
}

/**
 * The path of a company's filings.
 *
 * @param cik - The company's CIK.
 * @returns The path, such as `/filings/320193`.
 */
export function filingsPathOf(cik: number): string {
  return `${FILINGS_PATH}/${cik}`;
}

/**
 * The empty state's title when the path names a CIK no company has.
 *
 * @param cik - The CIK from the path.
 * @returns The title, such as `No company has the CIK 42`.
 */
export function missingTitleOf(cik: number): string {
  return `No company has the CIK ${cik}`;
}

/** The form filter's segments: every form first, then one per bucket, under its label. */
export const FORM_FILTERS: readonly (SelectionItem & { readonly form: FormBucket | undefined })[] = [
  { key: 'all', label: 'All', form: undefined },
  ...FORM_BUCKETS.map((form) => ({ key: form, label: FORM_LABELS[form], form })),
];

/**
 * The height of the table's body, in pixels, before the page measures the space it has: about
 * twelve rows. The page holds the whole year, so the rows scroll in place of pages, and once
 * mounted the body grows or shrinks to the window, as `useFillHeight` sizes it.
 */
export const FILINGS_TABLE_HEIGHT = 640;

/**
 * The pixels under the table's top that are not its scrolling body: the library `Table`'s
 * header row, 40 at its default density, and the attached toolbar's 1-pixel bottom edge.
 */
export const FILINGS_TABLE_RESERVE = 41;

/** The least height of the table's body, about four rows; a shorter window scrolls the page. */
export const FILINGS_TABLE_MIN = 200;

/** The label of the empty state's button, which moves the focus to the topbar's search. */
export const SEARCH_LABEL = 'Search';

/** What the Filings page needs from the server; the real calls by default, a stand-in in tests. */
export interface FilingsPageApi extends FilingsApi {
  /** The company with the CIK, or `undefined` when no company has it. */
  findCompany(cik: number): Promise<Company | undefined>
  /** Sets the company in or out of the summary, and answers the company. */
  select(ticker: string, selected: boolean): Promise<Company>
}

/**
 * The few companies a CIK search reads. A digits-only `q` also matches a ticker prefix or a name
 * that holds those digits, so the answer is searched for the exact CIK rather than taken first.
 */
const CIK_SEARCH_SIZE = 10;

/** The real server calls of the Filings page, over the companies and filings clients. */
export const FILINGS_PAGE_API: FilingsPageApi = {
  findCompany: async (cik) => {
    const found = await companies.list({ page: 1, pageSize: CIK_SEARCH_SIZE, q: String(cik), selectedOnly: false });
    return found.items.find((company) => company.cik === cik);
  },
  list: (ticker, page, pageSize) => filings.list(ticker, page, pageSize),
  select: (ticker, selected) => companies.select(ticker, selected),
};

/**
 * Loads the company with the CIK and its whole stored year of filings, every form, newest
 * first: finds the company, then reads its filings by its ticker with `loadFilings`, a page of
 * the route's largest size at a time. The year is held whole so the table's headers sort all of
 * it and the form filter needs no call.
 *
 * @param api - The server calls.
 * @param cik - The company's CIK.
 * @returns The company and its filings, or `undefined` when no company has the CIK.
 * @throws {ApiError} When a call is refused.
 */
export async function loadCompanyFilings(api: FilingsPageApi, cik: number): Promise<FilingsResult | undefined> {
  const company = await api.findCompany(cik);
  if (company === undefined) return undefined;
  return loadFilings(api, company.ticker);
}
