import type { CompanySummary } from '../../api.ts';
import type { Column } from '@open-tomato/components';

import { Badge, Button, CellDoubleLine, ConfirmPopover, Table } from '@open-tomato/components';

import { FORM_BUCKETS, FORM_LABELS } from '../../components/filings/logic.ts';

/** What a form cell's bottom line shows when the company filed none of the form. */
export const NO_FILING_DATE = '—';

/**
 * The fixed column widths, in pixels, measured in the browser. A form column is as wide as its
 * header, such as `10-K · LATEST` in the mono caps with the sort arrow, which needs more than
 * its cell, so each bucket sets its own. The library's `Table` shares the width left over
 * equally among the columns that set none, so every column but the name sets one, and the name
 * takes the rest, at least `name`.
 */
export const SUMMARY_WIDTHS = {
  ticker: 96,
  name: 200,
  remove: 112,
  forms: { '10-K': 148, '10-Q': 148, '8-K': 140, '6-K': 140, '4': 160, '144': 176, other: 156 },
} as const;

/**
 * The narrowest the table draws: every fixed column and the name's least. Seven form columns
 * need more than a laptop leaves beside the nav, so below this width the table scrolls sideways
 * in its own box rather than squeezing the name to nothing.
 */
export const SUMMARY_MIN_WIDTH = SUMMARY_WIDTHS.ticker + SUMMARY_WIDTHS.name + SUMMARY_WIDTHS.remove
  + Object.values(SUMMARY_WIDTHS.forms).reduce((sum, width) => sum + width, 0);

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
 * that opens the company's filings, one column per entry of `FORM_BUCKETS`, and last a Remove
 * button behind a `ConfirmPopover`, so the company leaves the summary only once confirmed. A form
 * column is the library's `CellDoubleLine`, as the library's amount-over-time cell: the count on
 * top, the day of the latest filing of the form small below, and a header that names both lines
 * with a dot between them, such as `10-K · Latest` or `Other · Latest`. It sorts by the count. The name takes the
 * width the {@link SUMMARY_WIDTHS} leave, and a name too long for it is cut with an ellipsis and
 * shown whole in the library's tooltip.
 *
 * @param handlers - The row handlers, as {@link SummaryRowHandlers} lists them.
 * @returns The columns, for the library's `Table`.
 */
export function summaryColumns({ onOpenFilings, onRemove }: SummaryRowHandlers = {}): Column<CompanySummary>[] {
  const formColumns = FORM_BUCKETS.map((form): Column<CompanySummary> => ({
    key: form,
    header: `${FORM_LABELS[form]} · Latest`,
    width: SUMMARY_WIDTHS.forms[form],
    align: 'end',
    sortable: true,
    sortAccessor: (company) => company.counts[form],
    cell: (company) => <CellDoubleLine title={company.counts[form]} subtitle={company.lastFiled[form] ?? NO_FILING_DATE} />,
  }));
  return [
    {
      key: 'ticker',
      header: 'Ticker',
      width: SUMMARY_WIDTHS.ticker,
      sortable: true,
      cell: (company) => <Badge tone="neutral">{company.ticker}</Badge>,
    },
    {
      key: 'name',
      header: 'Company',
      overflow: 'truncate',
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
      width: SUMMARY_WIDTHS.remove,
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
 * selected company keyed by ticker, inside a box that scrolls sideways once the page is
 * narrower than {@link SUMMARY_MIN_WIDTH}.
 *
 * @param props - The companies and the handlers, as {@link SummaryTableProps} lists them.
 * @returns The table.
 */
export function SummaryTable({ companies: rows, onOpenFilings, onRemove }: SummaryTableProps) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: SUMMARY_MIN_WIDTH }}>
        <Table columns={summaryColumns({ onOpenFilings, onRemove })} data={rows} getRowId={(company) => company.ticker} />
      </div>
    </div>
  );
}
