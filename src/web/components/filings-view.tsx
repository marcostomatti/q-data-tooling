import type { SelectionItem } from '@open-tomato/components';

import { Banner, Content, Drawer, EmptyState, EntityCard, Modal, Segmented } from '@open-tomato/components';
import { useEffect, useState } from 'react';

import { filings, type Filing, type FilingPage } from '../api.ts';

/** The base form the latest card is drawn for. */
export const LATEST_FORM = '10-K';

/** The most filings one request asks for, the route's own largest page size. */
export const FILINGS_PAGE_SIZE = 100;

/**
 * The most pages one load fetches. Only the last year of filings is stored, so a company past
 * this many hundreds would mean a broken total, and the load stops instead of looping.
 */
export const FILINGS_MAX_PAGES = 10;

/** What the view says while the filings are on their way. */
export const FILINGS_LOADING = 'Loading filings…';

/** What the view's empty state says when the company filed none of the tracked forms in the last year. */
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

/**
 * The modal's full-screen frame. `Modal` sizes stop at `lg`, 620px wide, so this one class string
 * stretches its panel over the viewport; `cn` in the library merges it over the size's width.
 */
const FULL_SCREEN_MODAL = 'h-dvh max-h-dvh w-screen rounded-none border-0';

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

/** The props of {@link LatestTenKCard}. */
export interface LatestTenKCardProps {
  /** The latest 10-K. */
  readonly filing: Filing
  /** Opens a link; the card hands it `links.document`. */
  readonly onOpenLink: (url: string) => void
}

/**
 * The latest 10-K as the library's `EntityCard`, after the example in "Front end": the title
 * {@link latestTitleOf} names, the report period in the meta footer, and the primary document's
 * file name as the body. Opening the card opens the filing's primary document.
 *
 * @param props - The filing and the link handler, as {@link LatestTenKCardProps} lists them.
 * @returns The card.
 */
export function LatestTenKCard({ filing, onOpenLink }: LatestTenKCardProps) {
  return (
    <EntityCard
      title={latestTitleOf(filing)}
      onOpen={() => onOpenLink(filing.links.document)}
      meta={(
        <>
          <span className="text-fg3">Period</span>
          <span className="ml-auto font-medium">{filing.reportDate ?? '—'}</span>
        </>
      )}
    >
      <p className="m-0 text-sm leading-relaxed text-fg2">{filing.primaryDocument}</p>
    </EntityCard>
  );
}

/** The props of {@link FilingsLayoutToggle}. */
export interface FilingsLayoutToggleProps {
  /** The layout shown. */
  readonly layout: FilingsLayout
  /** Asks for the other layout. */
  readonly onLayoutChange?: (layout: FilingsLayout) => void
}

/**
 * The toggle in the view's header between the drawer and the full-screen modal, as the
 * library's `Segmented`, one option per entry of {@link FILINGS_LAYOUTS}.
 *
 * @param props - The layout and its handler, as {@link FilingsLayoutToggleProps} lists them.
 * @returns The toggle.
 */
export function FilingsLayoutToggle({ layout, onLayoutChange }: FilingsLayoutToggleProps) {
  return (
    <Segmented
      aria-label="Filings layout"
      size="sm"
      items={FILINGS_LAYOUTS}
      index={FILINGS_LAYOUTS.findIndex((item) => item.key === layout)}
      onChange={(index: number) => {
        const next = FILINGS_LAYOUTS[index];
        if (next !== undefined) onLayoutChange?.(next.key);
      }}
    />
  );
}

/** The props of {@link FilingsPanel}: the layout toggle's, the loaded filings and the last failure. */
export interface FilingsPanelProps extends FilingsLayoutToggleProps {
  /** The company and its filings, unset before the answer. */
  readonly result?: FilingsResult
  /** Why the load failed, shown as an alert in place of the filings. */
  readonly error?: string
  /** Opens a link; the real one opens a new tab. */
  readonly onOpenLink?: (url: string) => void
}

/**
 * What the drawer and the modal both hold: the layout toggle in a header row, an alert when the
 * load failed, a loading line before the answer, the {@link LatestTenKCard} only when the company
 * filed a 10-K, and the library's `EmptyState` when it filed none of the tracked forms. Pure: it
 * holds no state and calls no API.
 *
 * @param props - The panel's values and handlers, as {@link FilingsPanelProps} lists them.
 * @returns The panel.
 */
export function FilingsPanel({ layout, onLayoutChange, result, error, onOpenLink = openInNewTab }: FilingsPanelProps) {
  const latest = result && latestTenKOf(result.filings);
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="end">
        <FilingsLayoutToggle layout={layout} onLayoutChange={onLayoutChange} />
      </Content>
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {error === undefined && result === undefined && <p className="m-0">{FILINGS_LOADING}</p>}
      {latest !== undefined && <LatestTenKCard filing={latest} onOpenLink={onOpenLink} />}
      {result?.filings.length === 0 && <EmptyState title={FILINGS_EMPTY_TITLE} />}
    </Content>
  );
}

/** The props of {@link FilingsView}: the panel's, and the ticker and close handler of the overlay. */
export interface FilingsViewProps extends FilingsPanelProps {
  /** The ticker of the company shown, the title until the company's name arrives. */
  readonly ticker: string
  /** Whether the overlay is open. */
  readonly open: boolean
  /** Closes the overlay. */
  readonly onClose: () => void
}

/**
 * The filings view as a pure view: the {@link FilingsPanel} in the library's right-side `Drawer`
 * at its `lg` size (option B), or in a full-screen `Modal` (option A), as `layout` names. The
 * company's name is the title and its ticker the eyebrow.
 *
 * @param props - The view's values and handlers, as {@link FilingsViewProps} lists them.
 * @returns The drawer or the modal.
 */
export function FilingsView(props: FilingsViewProps) {
  const { ticker, open, onClose, layout, result } = props;
  const title = result?.company.name ?? ticker;
  const panel = <FilingsPanel {...props} />;
  return layout === 'drawer'
    ? (
      <Drawer open={open} onClose={onClose} title={title} eyebrow={ticker} size="lg">
        {panel}
      </Drawer>
    )
    : (
      <Modal open={open} onClose={onClose} title={title} eyebrow={ticker} className={FULL_SCREEN_MODAL}>
        {panel}
      </Modal>
    );
}

/** The props of {@link FilingsDialog}. */
export interface FilingsDialogProps {
  /** The ticker whose filings to show; unset keeps the view closed. */
  readonly ticker: string | undefined
  /** Closes the view. */
  readonly onClose: () => void
  /** The server call. Defaults to the real one; tests inject a fake. */
  readonly api?: FilingsApi
  /** The layout to open on. */
  readonly initialLayout?: FilingsLayout
  /** Opens a link. Defaults to a new tab. */
  readonly onOpenLink?: (url: string) => void
}

/** What the dialog holds of one load: the ticker it was for, and its answer or its failure. */
interface Loaded {
  readonly ticker: string
  readonly result?: FilingsResult
  readonly error?: string
}

function messageOf(failure: unknown, ticker: string): string {
  return failure instanceof Error
    ? failure.message
    : `could not load the filings of ${ticker}`;
}

/**
 * The filings view with its state: the layout the toggle chose, and the last load of
 * `GET /api/companies/:ticker/filings` for the ticker, fetched again whenever the ticker changes.
 * An answer for a ticker the view has moved off is dropped, and one for an earlier ticker is
 * never shown under a later one.
 *
 * @param props - The ticker, the close handler, the server call, the first layout and the link
 *   handler, as {@link FilingsDialogProps} lists them.
 * @returns The view, open while a ticker is set.
 */
export function FilingsDialog({ ticker, onClose, api = filings, initialLayout = DEFAULT_LAYOUT, onOpenLink }: FilingsDialogProps) {
  const [layout, setLayout] = useState<FilingsLayout>(initialLayout);
  const [loaded, setLoaded] = useState<Loaded | undefined>();

  useEffect(() => {
    if (ticker === undefined) return undefined;
    let stale = false;
    // Fire-and-forget: both outcomes are handled in `then`, and a stale answer is dropped.
    void loadFilings(api, ticker).then(
      (result) => {
        if (!stale) setLoaded({ ticker, result });
      },
      (failure: unknown) => {
        if (!stale) setLoaded({ ticker, error: messageOf(failure, ticker) });
      },
    );
    return () => {
      stale = true;
    };
  }, [api, ticker]);

  const current = loaded?.ticker === ticker
    ? loaded
    : undefined;
  return (
    <FilingsView
      ticker={ticker ?? ''}
      open={ticker !== undefined}
      onClose={onClose}
      layout={layout}
      onLayoutChange={setLayout}
      result={current?.result}
      error={current?.error}
      onOpenLink={onOpenLink}
    />
  );
}
