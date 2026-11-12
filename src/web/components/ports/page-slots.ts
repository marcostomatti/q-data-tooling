/**
 * One place in a page list: a page, counted from 0, or a gap standing for the pages hidden
 * between two of them. A gap names its side, so the two gaps of one list have keys of their own.
 */
export type PageSlot =
  | { readonly kind: 'page', readonly index: number }
  | { readonly kind: 'gap', readonly side: 'start' | 'end' };

/** How many pages the list shows on each side of the current one. */
export const PAGE_SIBLINGS = 1;

/** The slots every windowed list holds besides the siblings: first, last, current and two gaps. */
const FIXED_SLOTS = 5;

const pageAt = (index: number): PageSlot => ({ kind: 'page', index });

/** The pages from `from` up to, not including, `to`. */
function pagesFrom(from: number, to: number): PageSlot[] {
  return Array.from({ length: to - from }, (_, offset) => pageAt(from + offset));
}

/**
 * The slots of a page list with `count` pages on page `index`: every page while they fit in
 * `2 × siblings + 5` slots, and past that, always that many: the first page, the last, the
 * current one with `siblings` on each side, and a gap for each run of hidden pages. A gap that
 * would hide one page shows that page instead, so the count of slots stays the same wherever the
 * current page is, and the buttons do not jump as the reader steps through.
 *
 * @param count - The page count, from 1.
 * @param index - The current page, from 0.
 * @param siblings - The pages shown on each side of the current one.
 * @returns The slots, in order.
 */
export function pageSlots(count: number, index: number, siblings: number = PAGE_SIBLINGS): readonly PageSlot[] {
  const slots = 2 * siblings + FIXED_SLOTS;
  if (count <= slots) return pagesFrom(0, count);
  const last = count - 1;
  const left = Math.max(index - siblings, 1);
  const right = Math.min(index + siblings, last - 1);
  const gapAtStart = left > 2;
  const gapAtEnd = right < last - 2;
  const edgeRun = slots - 2;
  if (!gapAtStart) return [...pagesFrom(0, edgeRun), { kind: 'gap', side: 'end' }, pageAt(last)];
  if (!gapAtEnd) return [pageAt(0), { kind: 'gap', side: 'start' }, ...pagesFrom(count - edgeRun, count)];
  return [pageAt(0), { kind: 'gap', side: 'start' }, ...pagesFrom(left, right + 1), { kind: 'gap', side: 'end' }, pageAt(last)];
}
