import { Content, SmallStatCard } from '@open-tomato/components';

import {
  AVERAGE_FILINGS_TITLE,
  LATEST_FILING_TITLE,
  NO_LATEST_FILING,
  TOTAL_FILINGS_TITLE,
  type SummaryStats,
} from './logic.ts';

/** The props of {@link SummaryStatCards}. */
export interface SummaryStatCardsProps {
  /** The figures the cards show. */
  readonly stats: SummaryStats
}

/**
 * The Summary page's top row: three compact `SmallStatCard`, the total filings of the selected
 * companies, the average per company, and the latest 10-K with the ticker that filed it.
 * The average goes in as text, because the card's number formatter rounds it to a whole number.
 *
 * @param props - The figures, as {@link SummaryStatCardsProps} lists them.
 * @returns The row of cards.
 */
export function SummaryStatCards({ stats }: SummaryStatCardsProps) {
  const { totalFilings, averagePerCompany, latest } = stats;
  return (
    <Content direction="row" gap="md">
      <SmallStatCard size="sm" title={TOTAL_FILINGS_TITLE} value={totalFilings} unit="filings" short={false} />
      <SmallStatCard size="sm" title={AVERAGE_FILINGS_TITLE} value={String(averagePerCompany)} unit="filings" />
      <SmallStatCard
        size="sm"
        title={LATEST_FILING_TITLE}
        value={latest?.filingDate ?? NO_LATEST_FILING}
        footer={latest?.ticker}
      />
    </Content>
  );
}
