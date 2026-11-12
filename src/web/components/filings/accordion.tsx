import type { FormBucket } from '../../../entities/filing.ts';
import type { Filing } from '../../api.ts';

import { Accordion, AccordionItem, Content } from '@open-tomato/components';

import { FilingRow } from './filing-row.tsx';
import { FORM_BUCKETS, FORM_LABELS, groupByForm, noFilingsOf } from './logic.ts';

/** The props of {@link FilingsAccordion}. */
export interface FilingsAccordionProps {
  /** The company's filings, newest first. */
  readonly filings: readonly Filing[]
  /** The buckets whose groups start open; the first one by default. */
  readonly defaultOpen?: readonly FormBucket[]
}

/**
 * The drawer's body (option B, variant 1): the library's `Accordion`, one item per bucket
 * titled with its label and its count, holding a {@link FilingRow} per filing, or
 * {@link noFilingsOf} when the form has none. Many groups can be open at once.
 *
 * @param props - The filings and the groups open at first, as {@link FilingsAccordionProps} lists them.
 * @returns The accordion.
 */
export function FilingsAccordion({ filings: list, defaultOpen = FORM_BUCKETS.slice(0, 1) }: FilingsAccordionProps) {
  return (
    <Accordion mode="multiple" defaultValue={[...defaultOpen]}>
      {groupByForm(list).map(({ form, filings: group }) => (
        <AccordionItem key={form} value={form} title={`${FORM_LABELS[form]} (${group.length})`}>
          {group.length === 0
            ? <p className="m-0 text-sm text-fg3">{noFilingsOf(form)}</p>
            : (
              <Content gap="sm">
                {group.map((filing) => <FilingRow key={filing.accessionNumber} filing={filing} />)}
              </Content>
            )}
        </AccordionItem>
      ))}
    </Accordion>
  );
}
