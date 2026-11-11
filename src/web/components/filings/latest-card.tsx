import type { Filing } from '../../api.ts';

import { EntityCard } from '@open-tomato/components';

import { latestTitleOf } from './logic.ts';

/** The props of {@link LatestTenKCard}. */
export interface LatestTenKCardProps {
  /** The latest 10-K. */
  readonly filing: Filing
  /** Opens a link; the card hands it `links.document`. */
  readonly onOpenLink: (url: string) => void
}

/**
 * The latest 10-K as the library's `EntityCard`, after the example in "Front end": the title
 * {@link latestTitleOf} names, the report period in the meta footer, and the primary document's
 * file name as the body. Opening the card opens the filing's primary document.
 *
 * @param props - The filing and the link handler, as {@link LatestTenKCardProps} lists them.
 * @returns The card.
 */
export function LatestTenKCard({ filing, onOpenLink }: LatestTenKCardProps) {
  return (
    <EntityCard
      title={latestTitleOf(filing)}
      onOpen={() => onOpenLink(filing.links.document)}
      meta={(
        <>
          <span className="text-fg3">Period</span>
          <span className="ml-auto font-medium">{filing.reportDate ?? '—'}</span>
        </>
      )}
    >
      <p className="m-0 text-sm leading-relaxed text-fg2">{filing.primaryDocument}</p>
    </EntityCard>
  );
}
