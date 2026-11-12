import { Pagination } from './ports/pagination.tsx';

/**
 * How many pages a total spans, at least one, so an empty result still has a page.
 *
 * @param total - The count of matching rows across every page.
 * @param pageSize - The most rows one page holds.
 * @returns The page count, from 1.
 */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The props of {@link Pager}. */
export interface PagerProps {
  /** The page shown, from 1. */
  readonly page: number
  /** The page count, from 1. */
  readonly pageCount: number
  /** Asks for another page, from 1. */
  readonly onPageChange?: (page: number) => void
}

/**
 * The pages of a list, counted from 1: the local {@link Pagination} port, which counts from 0,
 * so the page is shifted by one each way. The port windows a long list, so 321 pages draw nine
 * slots, not 321 buttons.
 *
 * @param props - The page, the count and the handler, as {@link PagerProps} lists them.
 * @returns The pages.
 */
export function Pager({ page, pageCount, onPageChange }: PagerProps) {
  return <Pagination aria-label="Pages" count={pageCount} index={page - 1} onChange={(index: number) => onPageChange?.(index + 1)} />;
}
