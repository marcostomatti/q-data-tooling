import type { Company } from '../../api.ts';
import type { EntityKind, IconName, SearchSuggestion } from '@open-tomato/components';

/** The most companies one search asks for: the most rows the library's `SearchSuggest` shows. */
export const SUGGESTION_COUNT = 5;

/** What the search box says while it is empty: the three things the server matches. */
export const SEARCH_PLACEHOLDER = 'Ticker, CIK or company…';

/** The label of the one row a refused search shows. */
export const SEARCH_FAILED_LABEL = 'The search failed';

/** The icon of a company's row: the landmark the Filings page's empty state shows, where a pick leads. */
export const COMPANY_ICON: IconName = 'landmark';

/** The icon of the row a refused search shows. */
export const FAILED_ICON: IconName = 'triangle-alert';

/**
 * The keystroke the library's `SearchSuggest` listens for on `window`, ⌘K, which focuses its
 * input and opens its list. The search checks `metaKey` or `ctrlKey` with the key `k`.
 */
export const SEARCH_HOTKEY: KeyboardEventInit = { key: 'k', metaKey: true, bubbles: true, cancelable: true };

/** What {@link focusCompanySearch} sends the keystroke to: `window`, or a stand-in in tests. */
export interface HotkeyTarget {
  /** Sends an event, as `window.dispatchEvent` does. */
  dispatchEvent(event: Event): boolean
}

/**
 * Moves the focus to the topbar's company search and opens its list, from anywhere in the app,
 * by pressing the search's own ⌘K on `window`. The caller needs no ref to the search, no context
 * and no prop passed down, so the two stay apart: only the keystroke is shared.
 *
 * @param target - Where the keystroke goes; `window` by default.
 * @param makeEvent - Builds the keystroke; a `KeyboardEvent` by default, which Bun's test run lacks.
 */
export function focusCompanySearch(
  target: HotkeyTarget = window,
  makeEvent: (init: KeyboardEventInit) => Event = (init) => new KeyboardEvent('keydown', init),
): void {
  target.dispatchEvent(makeEvent(SEARCH_HOTKEY));
}

/**
 * One company as a row of the library's `SearchSuggest`: the name on the top line, and on the
 * line below the ticker, the ten-digit CIK and the exchanges, joined with a dot. The ticker also
 * fills the row's pill, as its `kind`. `SearchSuggest` filters its rows again in the browser by
 * the label and that second line, so the line carries what the server matched on: a ticker
 * prefix and a CIK, with or without its leading zeros, are both inside `CIK 0000320193`. Without
 * them, a row the server found by ticker or CIK would be dropped.
 *
 * @param company - The company the server found.
 * @returns The row, with the {@link COMPANY_ICON} in its left box.
 */
export function suggestionOf(company: Company): SearchSuggestion {
  const parts = [company.ticker, `CIK ${company.cik10}`];
  const exchanges = company.exchanges.join(', ');
  return {
    kind: company.ticker,
    icon: COMPANY_ICON,
    label: company.name,
    sub: (exchanges.length > 0
      ? [...parts, exchanges]
      : parts).join(' · '),
  };
}

/**
 * The row a refused search shows in place of the companies. The library keeps only rows that
 * hold the typed text, so the second line starts with it, then names the failure.
 *
 * @param typed - The text the search asked for.
 * @param message - Why it failed.
 * @returns The row, with no `kind`, so it names no company, and the {@link FAILED_ICON}.
 */
export function failureOf(typed: string, message: string): SearchSuggestion {
  return { label: SEARCH_FAILED_LABEL, sub: `${typed} · ${message}`, icon: FAILED_ICON };
}

/**
 * The `EntityKindsProvider` map for the rows: one kind per ticker, each with no icon and no tone,
 * so every pill takes the library's default accent and shows the ticker.
 *
 * @param found - The companies the rows show.
 * @returns The map, by ticker.
 */
export function kindsOf(found: readonly Company[]): Readonly<Record<string, EntityKind>> {
  return Object.fromEntries(found.map((company) => [company.ticker, {}]));
}
