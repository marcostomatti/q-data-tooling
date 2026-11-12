import type { Filing } from '../../api.ts';

import { Content, Grid, SectionCard } from '@open-tomato/components';

import { FilingRow } from './filing-row.tsx';
import { filingCountOf, FORM_LABELS, groupByForm, noFilingsOf } from './logic.ts';

/** The props of {@link FilingsGrid}. */
export interface FilingsGridProps {
  /** The company's filings, newest first. */
  readonly filings: readonly Filing[]
}

/**
 * The modal's body (option A): the library's 3-column `Grid`, one `SectionCard` per bucket
 * titled with its label and its {@link filingCountOf} count, listing a {@link FilingRow} per filing
 * with its links, or {@link noFilingsOf} when the form has none. Every group shows at once.
 *
 * @param props - The filings, as {@link FilingsGridProps} lists them.
 * @returns The grid.
 */
export function FilingsGrid({ filings: list }: FilingsGridProps) {
  return (
    <Grid cols="3" gap="md">
      {groupByForm(list).map(({ form, filings: group }) => (
        <SectionCard key={form} title={FORM_LABELS[form]} subtitle={filingCountOf(group.length)}>
          {group.length === 0
            ? <p className="m-0 text-sm text-fg3">{noFilingsOf(form)}</p>
            : (
              <Content gap="sm">
                {group.map((filing) => <FilingRow key={filing.accessionNumber} filing={filing} />)}
              </Content>
            )}
        </SectionCard>
      ))}
    </Grid>
  );
}
