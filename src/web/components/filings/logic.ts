import type { FormBucket } from '../../../entities/filing.ts';
import type { Filing, FilingPage } from '../../api.ts';
import type { SelectionItem } from '@open-tomato/components';

/** The base form the latest card is drawn for. */
export const LATEST_FORM = '10-K';

/**
 * The buckets the app groups, filters and counts filings by, in the order they show: the six
 * named base forms, then `other` for every other form. It mirrors `FORM_BUCKETS` in
 * `src/entities/filing.ts`, which is imported as a type only so the bundle does not carry zod; a
 * test holds the two equal.
 */
export const FORM_BUCKETS: readonly FormBucket[] = ['10-K', '10-Q', '8-K', '6-K', '4', '144', 'other'];

/** The bucket of every base form the app does not name. */
export const OTHER_BUCKET = 'other' satisfies FormBucket;

/**
 * What the app calls each bucket. A form SEC numbers without letters reads as `Form 4`, the
 * way filers say it, so a bare `4` is not taken for a count.
 */
export const FORM_LABELS: Readonly<Record<FormBucket, string>> = {
  '10-K': '10-K',
  '10-Q': '10-Q',
  '8-K': '8-K',
  '6-K': '6-K',
  '4': 'Form 4',
  '144': 'Form 144',
  other: 'Other',
};

/**
 * The bucket a filing's base form counts under, the way `bucketOf` in `src/entities/filing.ts`
 * reads it.
 *
 * @param baseForm - The form without its `/A`, such as `10-K` or `SCHEDULE 13G`.
 * @returns The form itself when the app names it, `other` otherwise.
 */
export function bucketOfForm(baseForm: string): FormBucket {
  return FORM_BUCKETS.find((bucket) => bucket !== OTHER_BUCKET && bucket === baseForm) ?? OTHER_BUCKET;
}

/** The label of a filing's link to its primary document on sec.gov. */
export const DOCUMENT_LINK_LABEL = 'Document';

/** The label of a filing's inline XBRL viewer link. */
export const IX_VIEWER_LABEL = 'ix viewer';

/** The most filings one request asks for, the route's own largest page size. */
export const FILINGS_PAGE_SIZE = 100;

/**
 * The most pages one load fetches. Only the last year of filings is stored, so a company past
 * this many hundreds would mean a broken total, and the load stops instead of looping.
 */
export const FILINGS_MAX_PAGES = 10;

/** What the view says while the filings are on their way. */
export const FILINGS_LOADING = 'Loading filings…';

/** What the view's empty state says when the company filed nothing in the last year. */
export const FILINGS_EMPTY_TITLE = 'No filings in the last year';

/** The two bodies the view can show: option B, a right-side drawer, or option A, a full-screen modal. */
export type FilingsLayout = 'drawer' | 'modal';

/** The layout the view opens on: the drawer, option B. */
export const DEFAULT_LAYOUT: FilingsLayout = 'drawer';

/** The toggle's options, in the order the header shows them; each `key` is a {@link FilingsLayout}. */
export const FILINGS_LAYOUTS: readonly (SelectionItem & { readonly key: FilingsLayout })[] = [
  { key: 'drawer', label: 'Drawer' },
  { key: 'modal', label: 'Full screen' },
];

/** A company and every one of its filings the server holds, newest first. */
export interface FilingsResult {
  /** The company the ticker names. */
  readonly company: FilingPage['company']
  /** Every stored filing of the company, newest first. */
  readonly filings: readonly Filing[]
}

/** What the filings view needs from the server; the real one by default, a stand-in in tests. */
export interface FilingsApi {
  /** One page of the company's filings, newest first, with the company itself. */
  list(ticker: string, page: number, pageSize: number): Promise<FilingPage>
}

/**
 * Loads every filing of the company with the ticker, a page of {@link FILINGS_PAGE_SIZE} at a
 * time, until the pages hold the total the server counts, an empty page comes back, or
 * {@link FILINGS_MAX_PAGES} pages are read.
 *
 * @param api - The server call.
 * @param ticker - The company's ticker, such as `AAPL`.
 * @returns The company and its filings, newest first.
 * @throws {ApiError} When a page is refused, such as the 404 for a ticker no company trades under.
 */
export async function loadFilings(api: FilingsApi, ticker: string): Promise<FilingsResult> {
  const first = await api.list(ticker, 1, FILINGS_PAGE_SIZE);
  let items: readonly Filing[] = first.filings.items;
  let page = 1;
  let last = first.filings.items.length;
  while (items.length < first.filings.total && last > 0 && page < FILINGS_MAX_PAGES) {
    page += 1;
    // The pages are read in order, each after the one before it, so the order stays newest first.
     
    const next = await api.list(ticker, page, FILINGS_PAGE_SIZE);
    last = next.filings.items.length;
    items = [...items, ...next.filings.items];
  }
  return { company: first.company, filings: items };
}

/**
 * The company's latest 10-K: the filing of base form {@link LATEST_FORM}, an amendment counted
 * under its form, with the latest filing date, then the latest acceptance time, the order the
 * summary's `latest10K` reads.
 *
 * @param list - The company's filings, in any order.
 * @returns The latest 10-K, or `undefined` when the company filed none.
 */
export function latestTenKOf(list: readonly Filing[]): Filing | undefined {
  return list
    .filter((filing) => filing.baseForm === LATEST_FORM)
    .reduce<Filing | undefined>((latest, filing) => latest === undefined || isLater(filing, latest)
      ? filing
      : latest, undefined);
}

function isLater(filing: Filing, than: Filing): boolean {
  return filing.filingDate === than.filingDate
    ? filing.acceptedAt > than.acceptedAt
    : filing.filingDate > than.filingDate;
}

/**
 * The latest card's title, `Latest: 10-K <date>`, with the filing date as the server stores it.
 *
 * @param filing - The latest 10-K.
 * @returns The title, such as `Latest: 10-K 2025-10-31`.
 */
export function latestTitleOf(filing: Filing): string {
  return `Latest: ${LATEST_FORM} ${filing.filingDate}`;
}

/**
 * Opens a sec.gov link in a new tab, with no `window.opener` handed to it.
 *
 * @param url - The link to open.
 */
export function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** The filings of one bucket, newest first. */
export interface FormGroup {
  /** The bucket: a named base form, amendments counted under it, or `other`. */
  readonly form: FormBucket
  /** The form's filings, in the order the list held them. */
  readonly filings: readonly Filing[]
}

/**
 * Groups filings by bucket, one group per entry of {@link FORM_BUCKETS} in its order, each
 * keeping the order the list held, so a newest-first list gives newest-first groups. A bucket
 * the company filed nothing in is a group with no filings; every form the app does not name
 * goes in the `other` group.
 *
 * @param list - The company's filings.
 * @returns One group per bucket.
 */
export function groupByForm(list: readonly Filing[]): readonly FormGroup[] {
  return FORM_BUCKETS.map((form) => ({
    form,
    filings: filingsIn(list, form),
  }));
}

/**
 * The filings of one bucket, in the order the list held them.
 *
 * @param list - The company's filings.
 * @param bucket - The bucket to keep, or `undefined` to keep every filing.
 * @returns The filings whose base form counts under the bucket.
 */
export function filingsIn(list: readonly Filing[], bucket: FormBucket | undefined): readonly Filing[] {
  return bucket === undefined
    ? list
    : list.filter((filing) => bucketOfForm(filing.baseForm) === bucket);
}

/**
 * What a bucket's group says when the company filed none of it in the last year.
 *
 * @param form - The bucket.
 * @returns The line, such as `No 10-Q filings in the last year` or `No other filings in the last year`.
 */
export function noFilingsOf(form: FormBucket): string {
  const label = form === OTHER_BUCKET
    ? 'other'
    : FORM_LABELS[form];
  return `No ${label} filings in the last year`;
}

/**
 * The subtitle of a form's card in the modal: how many filings the group holds.
 *
 * @param count - The number of filings of the form.
 * @returns The line, such as `1 filing` or `4 filings`.
 */
export function filingCountOf(count: number): string {
  return count === 1
    ? '1 filing'
    : `${count} filings`;
}
