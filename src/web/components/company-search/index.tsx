import type { SearchSuggestion } from '@open-tomato/components';
import type { ChangeEvent } from 'react';

import { EntityKindsProvider, SearchSuggest } from '@open-tomato/components';
import { useEffect, useState } from 'react';

import { companies, messageOf, type Company, type CompanyPage, type CompanyQuery } from '../../api.ts';
import { SEARCH_DEBOUNCE_MS } from '../../pages/companies/logic.ts';

import { failureOf, kindsOf, SEARCH_PLACEHOLDER, SUGGESTION_COUNT, suggestionOf } from './logic.ts';

/** What the search needs from the server; the real `GET /api/companies` by default, a stand-in in tests. */
export interface CompanySearchApi {
  /** One page of the companies the query matches. */
  list(query: CompanyQuery): Promise<CompanyPage>
}

/** The props of {@link CompanySearch}. */
export interface CompanySearchProps {
  /** The server call. Defaults to the real one; tests inject a fake. */
  readonly api?: CompanySearchApi
  /** Opens the company with the CIK; the shell moves to its filings. */
  readonly onPick?: (cik: number) => void
  /** How long the search waits after the last keystroke, in milliseconds; tests pass 0. */
  readonly debounceMs?: number
}

/** The last answer: the text it was for, the companies found, or why the search failed. */
interface Answer {
  readonly typed: string
  readonly found: readonly Company[]
  readonly error?: string
}

const NO_ANSWER: Answer = { typed: '', found: [] };

/**
 * The company search in the topbar: the library's `SearchSuggest` over `GET /api/companies`,
 * which matches a ticker prefix, a part of the name or a whole CIK. `SearchSuggest` keeps its
 * text to itself and has no callback for it, so a wrapper reads the input's change event as it
 * bubbles, and the text is sent once the typing pauses. An answer that arrives after newer text
 * is dropped. Each row is a company under {@link suggestionOf}; picking one, or Enter with no
 * row picked, hands the company's CIK to `onPick`.
 *
 * @param props - The server call, the pick handler and the pause, as {@link CompanySearchProps}
 *   lists them.
 * @returns The search.
 */
export function CompanySearch({ api = companies, onPick, debounceMs = SEARCH_DEBOUNCE_MS }: CompanySearchProps) {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER);
  const typed = text.trim();

  useEffect(() => {
    if (typed === '') return undefined;
    let stale = false;
    const timer = setTimeout(() => {
      // Fire-and-forget: both outcomes are handled in `then`, and a stale answer is dropped.
      void api.list({ page: 1, pageSize: SUGGESTION_COUNT, q: typed, selectedOnly: false }).then(
        (page) => {
          if (!stale) setAnswer({ typed, found: page.items });
        },
        (failure: unknown) => {
          if (!stale) setAnswer({ typed, found: [], error: messageOf(failure, 'the server did not answer') });
        },
      );
    }, debounceMs);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [api, typed, debounceMs]);

  const shown = typed === ''
    ? NO_ANSWER
    : answer;
  const suggestions = shown.error === undefined
    ? shown.found.map(suggestionOf)
    : [failureOf(shown.typed, shown.error)];
  const pick = (company: Company | undefined): void => {
    if (company !== undefined) onPick?.(company.cik);
  };

  return (
    <div onChange={(event: ChangeEvent<HTMLDivElement>) => setText((event.target as unknown as HTMLInputElement).value)}>
      <EntityKindsProvider kinds={kindsOf(shown.found)}>
        <SearchSuggest
          suggestions={suggestions}
          placeholder={SEARCH_PLACEHOLDER}
          onSelect={(suggestion: SearchSuggestion) => pick(shown.found.find((company) => company.ticker === suggestion.kind))}
          onSearch={() => pick(shown.found[0])}
        />
      </EntityKindsProvider>
    </div>
  );
}
