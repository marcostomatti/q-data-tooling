import type { CompanySummary } from '../../api.ts';
import type { Column } from '@open-tomato/components';

import { Badge, Button, ConfirmPopover, Table } from '@open-tomato/components';

import { TRACKED_FORMS } from '../../components/filings/logic.ts';

/** The label of a summary row's button that takes the company out of the summary. */
export const REMOVE_LABEL = 'Remove';

/** The confirm button of the Remove popover, naming the action again. */
export const REMOVE_CONFIRM_LABEL = 'Yes, remove';

/**
 * The question the Remove popover asks, naming the company and the action.
 *
 * @param name - The company's name, such as `Apple Inc.`.
 * @returns The question, such as `Remove Apple Inc. from the summary?`.
 */
export function removeMessage(name: string): string {
  return `Remove ${name} from the summary?`;
}

/** What a summary row asks of its page: open the company's filings, or take it out of the summary. */
export interface SummaryRowHandlers {
  /** Opens the filings of the company with the ticker. */
  readonly onOpenFilings?: (ticker: string) => void
  /** Takes the company with the ticker out of the summary, once the reader confirmed it. */
  readonly onRemove?: (ticker: string) => void
}

/**
 * The summary table's columns, in order: the ticker as a `Badge`, the name as a `ghost` `Button`
 * that opens the company's filings, one count per entry of `TRACKED_FORMS`, and last a Remove
 * button behind a `ConfirmPopover`, so the company leaves the summary only once confirmed.
 *
 * @param handlers - The row handlers, as {@link SummaryRowHandlers} lists them.
 * @returns The columns, for the library's `Table`.
 */
export function summaryColumns({ onOpenFilings, onRemove }: SummaryRowHandlers = {}): Column<CompanySummary>[] {
  const formColumns = TRACKED_FORMS.map((form): Column<CompanySummary> => ({
    key: form,
    header: form,
    align: 'end',
    sortable: true,
    sortAccessor: (company) => company.counts[form],
    cell: (company) => company.counts[form],
  }));
  return [
    {
      key: 'ticker',
      header: 'Ticker',
      sortable: true,
      cell: (company) => <Badge tone="neutral">{company.ticker}</Badge>,
    },
    {
      key: 'name',
      header: 'Company',
      sortable: true,
      cell: (company) => (
        <Button variant="ghost" size="sm" onClick={() => onOpenFilings?.(company.ticker)}>
          {company.name}
        </Button>
      ),
    },
    ...formColumns,
    {
      key: 'remove',
      header: '',
      align: 'end',
      cell: (company) => (
        <ConfirmPopover
          message={removeMessage(company.name)}
          confirmLabel={REMOVE_CONFIRM_LABEL}
          danger
          align="end"
          onConfirm={() => onRemove?.(company.ticker)}
        >
          <Button variant="secondary" size="sm">
            {REMOVE_LABEL}
          </Button>
        </ConfirmPopover>
      ),
    },
  ];
}

/** The props of {@link SummaryTable}: the companies and the row handlers. */
export interface SummaryTableProps extends SummaryRowHandlers {
  /** The selected companies' summaries, one row each. */
  readonly companies: readonly CompanySummary[]
}

/**
 * The Summary page's table, the library's `Table` over {@link summaryColumns}, one row per
 * selected company keyed by ticker.
 *
 * @param props - The companies and the handlers, as {@link SummaryTableProps} lists them.
 * @returns The table.
 */
export function SummaryTable({ companies: rows, onOpenFilings, onRemove }: SummaryTableProps) {
  return <Table columns={summaryColumns({ onOpenFilings, onRemove })} data={rows} getRowId={(company) => company.ticker} />;
}
