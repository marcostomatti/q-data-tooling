import type { FormBucket } from '../../../entities/filing.ts';

import { Segmented, ToolbarControls, ToolbarSummary } from '@open-tomato/components';

import { filingCountOf } from '../../components/filings/logic.ts';

import { FORM_FILTERS } from './logic.ts';

/** The props of {@link FilingsControls}: the bucket shown and the handler that changes it. */
export interface FilingsControlsProps {
  /** The bucket kept, or `undefined` for every form. */
  readonly form: FormBucket | undefined
  /** Keeps only one bucket, or every form for `undefined`. */
  readonly onFormChange?: (form: FormBucket | undefined) => void
}

/**
 * The toolbar's controls row: the form filter, the library's `Segmented` with one segment per
 * entry of `FORM_FILTERS`. The order is the table's own, set from its Filed and Form headers.
 *
 * @param props - The bucket and the handler, as {@link FilingsControlsProps} lists them.
 * @returns The controls row.
 */
export function FilingsControls({ form, onFormChange }: FilingsControlsProps) {
  return (
    <ToolbarControls>
      <Segmented
        aria-label="Filter by form"
        size="sm"
        items={FORM_FILTERS}
        index={FORM_FILTERS.findIndex((item) => item.form === form)}
        onChange={(index: number) => {
          const picked = FORM_FILTERS[index];
          if (picked !== undefined) onFormChange?.(picked.form);
        }}
      />
    </ToolbarControls>
  );
}

/** The props of {@link FilingsSummary}. */
export interface FilingsSummaryProps {
  /** The count of filings the table shows. */
  readonly shown: number
}

/**
 * The toolbar's summary row, divided from the controls as in the library's attached toolbar
 * story: the count of filings the filter keeps.
 *
 * @param props - The count, as {@link FilingsSummaryProps} lists it.
 * @returns The summary row.
 */
export function FilingsSummary({ shown }: FilingsSummaryProps) {
  return (
    <ToolbarSummary divided>
      <span>{filingCountOf(shown)}</span>
    </ToolbarSummary>
  );
}
