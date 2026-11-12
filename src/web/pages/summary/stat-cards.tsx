import { Grid, SmallStatCard } from '@open-tomato/components';

import { FORM_LABELS } from '../../components/filings/logic.ts';

import {
  AVERAGE_FILINGS_TITLE,
  LATEST_FILING_TITLE,
  MOST_FILINGS_TITLE,
  NEWEST_FILING_TITLE,
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
 * The Summary page's top row: five compact `SmallStatCard` in the library's auto `Grid`, so they
 * share the row's width: the total filings of the selected companies, the average per company,
 * the company with the most filings, the newest filing of any form with the company and the
 * form that filed it, and the latest 10-K with the ticker that filed it. The average goes in as
 * text, because the card's number formatter rounds it to a whole number.
 *
 * @param props - The figures, as {@link SummaryStatCardsProps} lists them.
 * @returns The row of cards.
 */
export function SummaryStatCards({ stats }: SummaryStatCardsProps) {
  const { totalFilings, averagePerCompany, busiest, newest, latest } = stats;
  return (
    <Grid gap="md">
      <SmallStatCard size="sm" title={TOTAL_FILINGS_TITLE} value={totalFilings} unit="filings" short={false} />
      <SmallStatCard size="sm" title={AVERAGE_FILINGS_TITLE} value={String(averagePerCompany)} unit="filings" />
      <SmallStatCard
        size="sm"
        title={MOST_FILINGS_TITLE}
        value={busiest?.total ?? NO_LATEST_FILING}
        unit={busiest === undefined
          ? undefined
          : 'filings'}
        short={false}
        footer={busiest?.ticker}
      />
      <SmallStatCard
        size="sm"
        title={NEWEST_FILING_TITLE}
        value={newest?.filingDate ?? NO_LATEST_FILING}
        footer={newest && `${newest.ticker} · ${FORM_LABELS[newest.form]}`}
      />
      <SmallStatCard
        size="sm"
        title={LATEST_FILING_TITLE}
        value={latest?.filingDate ?? NO_LATEST_FILING}
        footer={latest?.ticker}
      />
    </Grid>
  );
}
