import { useEffect, useState } from 'react';

import { filings, messageOf } from '../../api.ts';

import { DEFAULT_LAYOUT, loadFilings, type FilingsApi, type FilingsLayout, type FilingsResult } from './logic.ts';
import { FilingsView } from './view.tsx';

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
        if (!stale) setLoaded({ ticker, error: messageOf(failure, `could not load the filings of ${ticker}`) });
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
