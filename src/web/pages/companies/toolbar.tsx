import {
  SearchInput,
  Segmented,
  Toolbar,
  ToolbarControls,
  ToolbarSep,
  ToolbarSummary,
} from '@open-tomato/components';

import { Pager } from '../../components/pager.tsx';

import { COMPANY_FILTERS } from './logic.ts';

/** The props of {@link CompaniesToolbar}. */
export interface CompaniesToolbarProps {
  /** The search text as typed, ahead of the debounce. */
  readonly search: string
  readonly selectedOnly: boolean
  /** The page shown, from 1. */
  readonly page: number
  /** The page count, from 1. */
  readonly pageCount: number
  /** The count of matching companies across every page. */
  readonly total: number
  readonly onSearchChange?: (text: string) => void
  readonly onSelectedOnlyChange?: (selectedOnly: boolean) => void
  /** Asks for another page, from 1. */
  readonly onPageChange?: (page: number) => void
}

/**
 * The control bar over the company list: the search, the All / Selected filter as the library's
 * `Segmented`, then the {@link Pager} at the start of the summary row and the count at its end.
 * The pager comes first so it keeps its place whatever the count's width, which changes with
 * the filter. The pager is the local `Pagination` port, which windows the full list's hundreds
 * of pages around the current one.
 *
 * @param props - The bar's values and handlers, as {@link CompaniesToolbarProps} lists them.
 * @returns The toolbar.
 */
export function CompaniesToolbar(props: CompaniesToolbarProps) {
  const { search, selectedOnly, page, pageCount, total, onSearchChange, onSelectedOnlyChange, onPageChange } = props;
  return (
    <Toolbar>
      <ToolbarControls>
        <SearchInput
          aria-label="Search companies"
          placeholder="Ticker or name…"
          value={search}
          onChange={(text: string) => onSearchChange?.(text)}
        />
        <ToolbarSep />
        <Segmented
          aria-label="Filter companies"
          size="sm"
          items={COMPANY_FILTERS}
          index={selectedOnly
            ? 1
            : 0}
          onChange={(index: number) => onSelectedOnlyChange?.(index === 1)}
        />
      </ToolbarControls>
      <ToolbarSummary>
        <Pager page={page} pageCount={pageCount} onPageChange={onPageChange} />
        <span className="ml-auto">{total === 1
          ? '1 company'
          : `${total} companies`}
        </span>
      </ToolbarSummary>
    </Toolbar>
  );
}
