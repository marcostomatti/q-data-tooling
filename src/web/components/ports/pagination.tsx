import type { HTMLAttributes } from 'react';

import { cn, paginationButton, touchableVariants } from '@open-tomato/components';

import { PAGE_SIBLINGS, pageSlots } from './page-slots.ts';

/**
 * The props of {@link Pagination}: the library's own, `count`, `index` and `onChange`, with
 * `siblings` added.
 */
export interface PaginationProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** The page count, from 1. */
  readonly count: number
  /** The current page, from 0. */
  readonly index: number
  /** Asks for a page, from 0. */
  readonly onChange?: (index: number) => void
  /** The pages shown on each side of the current one; {@link PAGE_SIBLINGS} by default. */
  readonly siblings?: number
}

/** The library's `paginationRoot`, which its package does not export. */
const ROOT = 'inline-flex items-center gap-1';

/** A gap's box: a page button's size and face, with no border, fill or press. */
const GAP = 'inline-flex min-w-8 h-8 items-center justify-center font-mono text-[13px] text-fg3';

/** The press behaviour every button of the list shares, as the library's `Pagination` sets it. */
const PRESS = touchableVariants({ inline: true, rounded: 'md', noBrightness: false });

/** The library's arrow, a 15px chevron. */
function Arrow({ left = false }: { readonly left?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={left
        ? 'M15 18l-6-6 6-6'
        : 'M9 18l6-6-6-6'}
      />
    </svg>
  );
}

/**
 * A local port of the library's `Pagination` (`@open-tomato/components` 0.2.0) with windowing.
 * The library draws one button per page, so 321 pages of companies drew 321 buttons; this one
 * draws the {@link pageSlots}: the first and last pages, the current one with its siblings, and
 * an ellipsis for each hidden run. Everything else is the library's: its props, its Previous
 * and Next arrows with their labels, `aria-current="page"` on the current page, and its
 * `paginationButton` and press variants. The fix is meant to move into the library, and this
 * file to go with it.
 *
 * @param props - The library's props and `siblings`, as {@link PaginationProps} lists them.
 * @returns The page list.
 */
export function Pagination({ className, count, index, onChange, siblings = PAGE_SIBLINGS, ...props }: PaginationProps) {
  return (
    <div className={cn(ROOT, className)} {...props}>
      <button
        type="button"
        aria-label="Previous"
        disabled={index === 0}
        onClick={() => onChange?.(Math.max(0, index - 1))}
        className={cn(PRESS, paginationButton({ active: false }))}
      >
        <Arrow left />
      </button>
      {pageSlots(count, index, siblings).map((slot) => (slot.kind === 'gap'
        ? <span key={`gap-${slot.side}`} className={GAP} aria-hidden>…</span>
        : (
          <button
            key={slot.index}
            type="button"
            aria-current={slot.index === index
              ? 'page'
              : undefined}
            onClick={() => onChange?.(slot.index)}
            className={cn(PRESS, paginationButton({ active: slot.index === index }))}
          >
            {slot.index + 1}
          </button>
        )))}
      <button
        type="button"
        aria-label="Next"
        disabled={index === count - 1}
        onClick={() => onChange?.(Math.min(count - 1, index + 1))}
        className={cn(PRESS, paginationButton({ active: false }))}
      >
        <Arrow />
      </button>
    </div>
  );
}
