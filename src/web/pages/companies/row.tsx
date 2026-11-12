import type { Company } from '../../api.ts';

import { RowStatCard, Switch, Touchable } from '@open-tomato/components';

import { NO_EXCHANGE, NOT_SYNCED } from './logic.ts';

/** What a company row asks of its page: open the company's filings, or set it in the summary. */
export interface CompanyRowHandlers {
  /** Opens the filings of the company with the ticker; unset draws the name as plain text. */
  readonly onOpenFilings?: (ticker: string) => void
  /** Sets the company with the ticker in or out of the summary, with the switch's next state. */
  readonly onSelectedChange?: (ticker: string, selected: boolean) => void
}

/** The props of {@link CompanyRow}: the company and the row's handlers. */
export interface CompanyRowProps extends CompanyRowHandlers {
  readonly company: Company
}

/**
 * One company as the library's `RowStatCard`, after its stats-only story: the ticker as the
 * title, the name as an inline `Touchable` that opens the filings, or as plain text when nothing
 * opens them, as on the Filings page. `Touchable` is the library's press behaviour with no fill
 * and no padding, so the name starts where the ticker does, in the subtitle's own text. Three
 * ministats (the day of the
 * last sync, the CIK and the exchanges) and a `Switch` on the right that sets the company in the
 * summary. The card lines its ministats up from the right, so the sync day goes first: when a
 * sync turns `never` into a date, only its own column widens, and the CIK and exchange stay put. The card's `title` takes only a string, so the name button sits in `subtitle`;
 * `DecoratedToggle` and `OptionCard` were passed over because each draws its whole body as one
 * `<button>`, which a `Button` inside would nest in.
 *
 * @param props - The company and the handlers, as {@link CompanyRowProps} lists them.
 * @returns The card.
 */
export function CompanyRow({ company, onOpenFilings, onSelectedChange }: CompanyRowProps) {
  const exchanges = company.exchanges.join(', ');
  return (
    <RowStatCard
      title={company.ticker}
      subtitle={onOpenFilings === undefined
        ? company.name
        : (
          <Touchable inline rounded="sm" onClick={() => onOpenFilings(company.ticker)}>
            {company.name}
          </Touchable>
        )}
      stats={[
        company.filingsSyncedAt === null
          ? { title: 'synced', value: NOT_SYNCED, tone: 'muted' }
          : { title: 'synced', value: company.filingsSyncedAt.slice(0, 10) },
        { title: 'cik', value: company.cik },
        exchanges.length > 0
          ? { title: 'exchange', value: exchanges }
          : { title: 'exchange', value: NO_EXCHANGE, tone: 'muted' },
      ]}
      action={(
        <Switch
          aria-label={`Show ${company.name} in the summary`}
          checked={company.selected}
          onChange={(next: boolean) => onSelectedChange?.(company.ticker, next)}
        />
      )}
    />
  );
}
