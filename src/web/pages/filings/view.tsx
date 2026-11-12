import type { FilingsResult } from '../../components/filings/logic.ts';
import type { CompanyRowHandlers } from '../companies/row.tsx';

import { Banner, Button, Content, EmptyState, Icon, Table, Toolbar } from '@open-tomato/components';

import { FILINGS_EMPTY_TITLE, filingsIn, noFilingsOf } from '../../components/filings/logic.ts';
import { CompanyRow } from '../companies/row.tsx';

import { FILINGS_TABLE_HEIGHT, missingTitleOf, NOTHING_DESCRIPTION, NOTHING_TITLE, SEARCH_LABEL } from './logic.ts';
import { filingColumns, NEWEST_FIRST } from './table.tsx';
import { FilingsControls, FilingsSummary, type FilingsControlsProps } from './toolbar.tsx';

/** The props of {@link FilingsView}: the company's CIK, its loaded year, and the handlers. */
export interface FilingsViewProps extends FilingsControlsProps, Pick<CompanyRowHandlers, 'onSelectedChange'> {
  /** The CIK from the path, or unset while no company is picked. */
  readonly cik?: number
  /** The company and its whole stored year of filings, unset before the first answer. */
  readonly result?: FilingsResult
  /** Set when no company has the CIK. */
  readonly missing?: boolean
  /** Why the last load or change failed, shown as an alert. */
  readonly error?: string
  /** Called by the empty state's Search button, which moves the focus to the topbar's search. */
  readonly onSearch?: () => void
  /** The height of the table's body, in pixels; {@link FILINGS_TABLE_HEIGHT} when unset. */
  readonly tableHeight?: number
  /** The ref of the box around the table, which the page measures the space below from. */
  readonly tableRef?: (element: HTMLElement | null) => void
}

/** The landmark icon over each of the page's empty states. */
const LANDMARK = <Icon name="landmark" size={24} />;

/**
 * The Filings page as a pure view. With no company picked, or a CIK no company has, it is the
 * library's `EmptyState` under a landmark, with a Search button that calls `onSearch`. With a
 * company, it is the company's card, then the library's `Toolbar` in its attached form: the
 * form filter, the count of filings it keeps, and the `Table` of them inside it with no frame
 * of its own, its body scrolling past `tableHeight`, or an `EmptyState` when no filing matches.
 * The table sits in a plain box carrying `tableRef`, so the page can size the body to the
 * window. The title is the shell's topbar `h1`. Pure: it holds no state and calls no API.
 *
 * @param props - The view's values and handlers, as {@link FilingsViewProps} lists them.
 * @returns The page.
 */
export function FilingsView(props: FilingsViewProps) {
  const { cik, result, missing = false, error, form, onSelectedChange, onSearch, tableHeight = FILINGS_TABLE_HEIGHT, tableRef } = props;
  if (cik === undefined || missing) {
    return (
      <EmptyState
        illustration={LANDMARK}
        title={cik === undefined
          ? NOTHING_TITLE
          : missingTitleOf(cik)}
        description={NOTHING_DESCRIPTION}
        action={(
          <Button size="sm" onClick={() => onSearch?.()}>
            {SEARCH_LABEL}
          </Button>
        )}
      />
    );
  }
  const shown = filingsIn(result?.filings ?? [], form);
  return (
    <Content gap="lg">
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {result !== undefined && <CompanyRow company={result.company} onSelectedChange={onSelectedChange} />}
      {result !== undefined && (
        <Toolbar>
          <FilingsControls {...props} />
          <FilingsSummary shown={shown.length} />
          {shown.length > 0
            ? (
              <div ref={tableRef}>
                <Table
                  columns={filingColumns()}
                  data={shown}
                  getRowId={(filing) => filing.accessionNumber}
                  frame={false}
                  layout="scroll"
                  maxHeight={tableHeight}
                  initialSort={NEWEST_FIRST}
                />
              </div>
            )
            : (
              <EmptyState
                title={form === undefined
                  ? FILINGS_EMPTY_TITLE
                  : noFilingsOf(form)}
              />
            )}
        </Toolbar>
      )}
    </Content>
  );
}
