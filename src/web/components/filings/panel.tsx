import { Banner, Content, EmptyState, Segmented } from '@open-tomato/components';

import { FilingsAccordion } from './accordion.tsx';
import { FilingsGrid } from './grid.tsx';
import { LatestTenKCard } from './latest-card.tsx';
import {
  FILINGS_EMPTY_TITLE,
  FILINGS_LAYOUTS,
  FILINGS_LOADING,
  latestTenKOf,
  openInNewTab,
  type FilingsLayout,
  type FilingsResult,
} from './logic.ts';

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
 * filed a 10-K, and the library's `EmptyState` when it filed none of the tracked forms. In the
 * drawer layout the {@link FilingsAccordion} follows, and in the modal layout the
 * {@link FilingsGrid}, once there are filings. Pure: it holds no state and calls no API.
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
      {layout === 'drawer' && result !== undefined && result.filings.length > 0 && (
        <FilingsAccordion filings={result.filings} />
      )}
      {layout === 'modal' && result !== undefined && result.filings.length > 0 && (
        <FilingsGrid filings={result.filings} />
      )}
    </Content>
  );
}
