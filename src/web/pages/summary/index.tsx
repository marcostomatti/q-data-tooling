import type { FilingsApi } from '../../components/filings/logic.ts';

import { useEffect, useState } from 'react';

import { companies, messageOf, summary, type SummaryPage } from '../../api.ts';
import { FilingsDialog } from '../../components/filings/index.tsx';
import { navigate } from '../../router.ts';

import { COMPANIES_PATH, SUMMARY_PAGE_SIZE, withoutCompany, type RemoveApi, type SummaryApi } from './logic.ts';
import { SummaryView } from './view.tsx';

/** The props of {@link SummaryPage}. */
export interface SummaryPageProps {
  /** The server call. Defaults to the real one; tests inject a fake. */
  readonly api?: SummaryApi
  /** The first summary, for a render with no server. */
  readonly initial?: SummaryPage
  /** The Remove's server call, `PATCH /api/companies/:ticker`. Defaults to the real one; tests inject a fake. */
  readonly removeApi?: RemoveApi
  /** Called with the ticker whose filings view the page opens, after the page opens it. */
  readonly onOpenFilings?: (ticker: string) => void
  /** The filings view's server call. Defaults to the real one; tests inject a fake. */
  readonly filingsApi?: FilingsApi
  /** Moves the app to a path. Defaults to the app's router; tests inject a fake. */
  readonly onNavigate?: (path: string) => void
}

/**
 * The Summary page at `/summary`: fetches `GET /api/filings/summary` once, up to
 * {@link SUMMARY_PAGE_SIZE} companies, and shows the filings of the selected companies. The route
 * reads the database only, so the page never triggers an SEC call. A failed fetch shows its
 * message and leaves the page on what it held. A row's confirmed Remove sends
 * `PATCH /api/companies/:ticker` with `selected: false`, never a toggle, and the row leaves the
 * table once the server answers; a refusal shows its message and keeps the row. A row's name
 * opens the filings view for its ticker, and closing the view clears the ticker. With no company
 * selected, the empty state's button moves the app to the Companies page.
 *
 * @param props - The server calls, the first summary, the filings handler and the router, as
 *   {@link SummaryPageProps} lists them.
 * @returns The page.
 */
export function SummaryPage({ api = summary, initial, removeApi = companies, onOpenFilings, filingsApi, onNavigate = navigate }: SummaryPageProps = {}) {
  const [filingsTicker, setFilingsTicker] = useState<string | undefined>();
  const [result, setResult] = useState<SummaryPage | undefined>(initial);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let stale = false;
    // Fire-and-forget: both outcomes are handled in `then`, and a stale answer is dropped.
    void api.list(1, SUMMARY_PAGE_SIZE).then(
      (next) => {
        if (stale) return;
        setResult(next);
        setError(undefined);
      },
      (failure: unknown) => {
        if (!stale) setError(messageOf(failure, 'could not load the summary'));
      },
    );
    return () => {
      stale = true;
    };
  }, [api]);

  const onRemove = (ticker: string): void => {
    // Fire-and-forget from a click handler: both outcomes are handled in `then`.
    void removeApi.select(ticker, false).then(
      () => {
        setResult((current) => current && withoutCompany(current, ticker));
        setError(undefined);
      },
      (failure: unknown) => setError(messageOf(failure, `could not remove ${ticker}`)),
    );
  };

  const openFilings = (ticker: string): void => {
    setFilingsTicker(ticker);
    onOpenFilings?.(ticker);
  };

  return (
    <>
      <SummaryView
        result={result}
        error={error}
        onOpenFilings={openFilings}
        onRemove={onRemove}
        onSelectCompanies={() => onNavigate(COMPANIES_PATH)}
      />
      <FilingsDialog ticker={filingsTicker} onClose={() => setFilingsTicker(undefined)} api={filingsApi} />
    </>
  );
}
