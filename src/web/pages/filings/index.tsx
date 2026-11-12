import type { FormBucket } from '../../../entities/filing.ts';
import type { FilingsResult } from '../../components/filings/logic.ts';

import { useEffect, useState } from 'react';

import { messageOf } from '../../api.ts';
import { focusCompanySearch } from '../../components/company-search/logic.ts';
import { useFillHeight } from '../../components/fill-height.ts';

import {
  FILINGS_PAGE_API,
  FILINGS_TABLE_HEIGHT,
  FILINGS_TABLE_MIN,
  FILINGS_TABLE_RESERVE,
  loadCompanyFilings,
  type FilingsPageApi,
} from './logic.ts';
import { FilingsView } from './view.tsx';

/** The props of {@link FilingsPage}. */
export interface FilingsPageProps {
  /** The CIK from the path, or unset while no company is picked. */
  readonly cik?: number
  /** The server calls. Defaults to the real ones; tests inject a fake. */
  readonly api?: FilingsPageApi
  /** What the empty state's Search button does. Defaults to focusing the topbar's search; tests inject a fake. */
  readonly onSearch?: () => void
}

/** What the page holds of its last load: the company's year of filings, or that no company has the CIK. */
interface Loaded {
  readonly result?: FilingsResult
  readonly missing?: boolean
}

/**
 * The Filings page: loads the company with the CIK and its whole stored year once, then holds
 * the form filter, which keeps a bucket of what is held with no new call. A load finds the
 * company by its CIK, then reads every page of its filings; an answer for a CIK the page has
 * left is dropped. The card's switch sends `PATCH /api/companies/:ticker`, and the answer
 * replaces the company. The app mounts one page per CIK, so a new company starts on every form.
 * The table's body fills the window below it, through `useFillHeight`, so the page itself does
 * not scroll past the table.
 *
 * @param props - The CIK, the server calls and the search handler, as {@link FilingsPageProps}
 *   lists them.
 * @returns The page.
 */
export function FilingsPage({ cik, api = FILINGS_PAGE_API, onSearch = focusCompanySearch }: FilingsPageProps) {
  const [form, setForm] = useState<FormBucket | undefined>();
  const [loaded, setLoaded] = useState<Loaded>({});
  const [error, setError] = useState<string | undefined>();
  const table = useFillHeight({ fallback: FILINGS_TABLE_HEIGHT, reserve: FILINGS_TABLE_RESERVE, min: FILINGS_TABLE_MIN });

  useEffect(() => {
    if (cik === undefined) return undefined;
    let stale = false;
    // Fire-and-forget: both outcomes are handled in `then`, and a stale answer is dropped.
    void loadCompanyFilings(api, cik).then(
      (result) => {
        if (stale) return;
        setLoaded(result === undefined
          ? { missing: true }
          : { result });
        setError(undefined);
      },
      (failure: unknown) => {
        if (!stale) setError(messageOf(failure, 'could not load the filings'));
      },
    );
    return () => {
      stale = true;
    };
  }, [api, cik]);

  const onSelectedChange = (ticker: string, selected: boolean): void => {
    // Fire-and-forget from a click handler: both outcomes are handled in `then`.
    void api.select(ticker, selected).then(
      (company) => {
        setLoaded((current) => current.result === undefined
          ? current
          : { result: { ...current.result, company } });
        setError(undefined);
      },
      (failure: unknown) => setError(messageOf(failure, `could not update ${ticker}`)),
    );
  };

  return (
    <FilingsView
      cik={cik}
      result={loaded.result}
      missing={loaded.missing}
      error={error}
      form={form}
      onFormChange={setForm}
      onSelectedChange={onSelectedChange}
      onSearch={onSearch}
      tableHeight={table.height}
      tableRef={table.ref}
    />
  );
}
