import { useEffect, useState } from 'react';

/** What {@link useFillHeight} reads of the page to size an element to the space below it. */
export interface FillMetrics {
  /** The scroll container's visible height, padding included: its `clientHeight`. */
  readonly scrollerHeight: number
  /** The scroll container's bottom padding, which the page keeps clear under its content. */
  readonly scrollerPaddingBottom: number
  /** How far the element's top sits below the top of the scroll container's content. */
  readonly offsetInScroller: number
}

/** How {@link useFillHeight} turns the space below an element into a height. */
export interface FillOptions {
  /** The height before the first measure, and where nothing can be measured, as in a render test. */
  readonly fallback: number
  /** The pixels inside the element that are not the part being sized, such as a table's header. */
  readonly reserve: number
  /** The least height given, so a short window scrolls the page in place of squashing the part. */
  readonly min: number
}

/**
 * The height that fills the scroll container down to its bottom padding, from the element's
 * top, less the element's own reserve; never under the minimum. Whole pixels, rounded down, so
 * a fraction of a pixel never tips the page into scrolling.
 *
 * @param metrics - The container's height and padding and the element's offset in it.
 * @param options - The reserve and the minimum.
 * @returns The height to give the sized part, in pixels.
 */
export function fillHeightOf(metrics: FillMetrics, options: Pick<FillOptions, 'reserve' | 'min'>): number {
  const space = metrics.scrollerHeight - metrics.scrollerPaddingBottom - metrics.offsetInScroller - options.reserve;
  return Math.max(options.min, Math.floor(space));
}

/** True when the element scrolls its content up and down, as the shell's main area does. */
function scrollsVertically(element: Element): boolean {
  return /(?:auto|scroll)/.test(getComputedStyle(element).overflowY);
}

/**
 * The nearest ancestor of the element that scrolls up and down, or `undefined` when only the
 * window does.
 *
 * @param element - The element to start from; it is not itself a candidate.
 * @returns The scroll container.
 */
export function scrollParentOf(element: Element): HTMLElement | undefined {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    if (scrollsVertically(parent)) return parent;
  }
  return undefined;
}

/** The metrics of the element inside its scroll container, independent of how far it is scrolled. */
function metricsOf(element: Element, scroller: HTMLElement): FillMetrics {
  const offsetInScroller = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  return {
    scrollerHeight: scroller.clientHeight,
    scrollerPaddingBottom: Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0,
    offsetInScroller,
  };
}

/** What {@link useFillHeight} hands back: the ref to put on the element, and its height. */
export interface FillHeight {
  /** The callback ref of the element whose top the height is measured from. */
  readonly ref: (element: HTMLElement | null) => void
  /** The height to give the sized part, {@link FillOptions.fallback} until the first measure. */
  readonly height: number
}

/**
 * Sizes a part of the page, such as a scrolling table's body, to the space between the ref'd
 * element's top and the bottom of the page's scroll container, so the page itself never
 * scrolls and the part never runs under the window's bottom edge. It measures again whenever
 * the container or its content changes size: a window resize, the sidebar's collapse, a
 * toolbar that wraps to a second line, an alert that appears above.
 *
 * @param options - The fallback height, the reserve and the minimum, as {@link FillOptions} lists them.
 * @returns The ref and the height.
 */
export function useFillHeight(options: FillOptions): FillHeight {
  const { fallback, reserve, min } = options;
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(fallback);

  useEffect(() => {
    if (element === null) return undefined;
    const scroller = scrollParentOf(element);
    if (scroller === undefined) return undefined;
    let frame = 0;
    // One measure per frame: a resize can report several times before the page paints.
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHeight(fillHeightOf(metricsOf(element, scroller), { reserve, min })));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.firstElementChild !== null) observer.observe(scroller.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [element, reserve, min]);

  return { ref: setElement, height };
}
