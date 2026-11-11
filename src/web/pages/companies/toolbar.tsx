import {
  Button,
  Content,
  SearchInput,
  Segmented,
  Toolbar,
  ToolbarControls,
  ToolbarSep,
  ToolbarSummary,
} from '@open-tomato/components';

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
 * `Segmented`, and Previous and Next buttons around `Page n of N`. The library's `Pagination`
 * draws one button per page, which the full ticker list would turn into hundreds, so the bar
 * steps a page at a time instead.
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
        <span>{total === 1
          ? '1 company'
          : `${total} companies`}
        </span>
        <Content direction="row" align="center" gap="sm">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
            Previous
          </Button>
          <span>{`Page ${page} of ${pageCount}`}</span>
          <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPageChange?.(page + 1)}>
            Next
          </Button>
        </Content>
      </ToolbarSummary>
    </Toolbar>
  );
}
