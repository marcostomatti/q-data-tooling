import { describe, expect, test } from 'bun:test';

import { fillHeightOf } from '../../src/web/components/fill-height.ts';
import { FILINGS_TABLE_MIN, FILINGS_TABLE_RESERVE } from '../../src/web/pages/filings/logic.ts';

/** The shell's main area at a 1440-pixel-tall window: 1380 visible, 28 of bottom padding. */
const TALL = { scrollerHeight: 1380, scrollerPaddingBottom: 28 } as const;

describe('fillHeightOf', () => {
  test('fills the space from the element down to the bottom padding, less the reserve', () => {
    // Arrange
    const metrics = { ...TALL, offsetInScroller: 233 };

    // Act
    const height = fillHeightOf(metrics, { reserve: 41, min: 200 });

    // Assert
    expect(height).toBe(1380 - 28 - 233 - 41);
  });

  test('never goes under the minimum, so a short window scrolls the page in place of squashing the part', () => {
    const height = fillHeightOf({ scrollerHeight: 400, scrollerPaddingBottom: 28, offsetInScroller: 233 }, { reserve: 41, min: 200 });
    expect(height).toBe(200);
  });

  test('rounds down, so a fraction of a pixel never tips the page into scrolling', () => {
    const height = fillHeightOf({ scrollerHeight: 708, scrollerPaddingBottom: 28, offsetInScroller: 212.6 }, { reserve: 41, min: 200 });
    expect(height).toBe(426);
  });

  test('the Filings table reserves its header row and the toolbar edge, and keeps about four rows at least', () => {
    expect(FILINGS_TABLE_RESERVE).toBe(41);
    expect(FILINGS_TABLE_MIN).toBe(200);
  });
});
