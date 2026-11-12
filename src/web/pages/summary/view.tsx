import type { SummaryPage } from '../../api.ts';

import { Banner, Button, Content, EmptyState } from '@open-tomato/components';

import { SummaryChart } from './chart.tsx';
import {
  COMPANIES_LINK_LABEL,
  SUMMARY_EMPTY_DESCRIPTION,
  SUMMARY_EMPTY_TITLE,
  summaryStats,
} from './logic.ts';
import { SummaryStatCards } from './stat-cards.tsx';
import { SummaryTable, type SummaryRowHandlers } from './table.tsx';

/** The props of {@link SummaryView}. */
export interface SummaryViewProps extends SummaryRowHandlers {
  /** The summary the page holds; `undefined` before the first answer. */
  readonly result?: SummaryPage
  /** Why the last fetch or removal failed, shown above the page's content. */
  readonly error?: string
  /** Called by the empty state's button, which points to the Companies page. */
  readonly onSelectCompanies?: () => void
}

/**
 * The Summary page as a pure view: the stat cards once a summary is held, a `Banner` with a
 * failed fetch's or removal's message, the {@link SummaryTable} and the {@link SummaryChart}
 * below it while the summary lists a company, and the library's `EmptyState` while it lists
 * none, with a button that calls `onSelectCompanies`. The title is the shell's topbar `h1`, from the nav label `SUMMARY_TITLE`, so the
 * view draws no heading. Pure: it holds no state and calls no API.
 *
 * @param props - The summary, the failure and the handlers, as {@link SummaryViewProps} lists them.
 * @returns The page.
 */
export function SummaryView({ result, error, onOpenFilings, onRemove, onSelectCompanies }: SummaryViewProps = {}) {
  const items = result?.items ?? [];
  return (
    <Content gap="lg">
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {result !== undefined && <SummaryStatCards stats={summaryStats(items)} />}
      {items.length > 0 && <SummaryTable companies={items} onOpenFilings={onOpenFilings} onRemove={onRemove} />}
      {items.length > 0 && <SummaryChart companies={items} />}
      {items.length === 0 && (
        <EmptyState
          title={SUMMARY_EMPTY_TITLE}
          description={SUMMARY_EMPTY_DESCRIPTION}
          action={(
            <Button size="sm" onClick={() => onSelectCompanies?.()}>
              {COMPANIES_LINK_LABEL}
            </Button>
          )}
        />
      )}
    </Content>
  );
}
