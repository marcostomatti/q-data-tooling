import type { Filing } from '../../api.ts';
import type { Column, SortState } from '@open-tomato/components';

import { Badge, Content, Entity } from '@open-tomato/components';

import { SecLink } from '../../components/filings/filing-row.tsx';
import { DOCUMENT_LINK_LABEL, IX_VIEWER_LABEL } from '../../components/filings/logic.ts';

/** The order the table opens on: by the Filed column, newest first, the order the server sends. */
export const NEWEST_FIRST: SortState = { key: 'filed', dir: 'desc' };

/**
 * The column widths, in pixels. The form column fits a badge as long as `SCHEDULE 13G/A`, and
 * the links column fits both links; the document takes the rest.
 */
const FILING_WIDTHS = { filed: 120, form: 150, links: 200 } as const;

/**
 * The filings table's columns, in the order a row reads: the filing date, the document (its
 * file name in the mono face over its accession number, the two names SEC gives a filing), the
 * form as filed in a `Badge`, amber for an amendment, and the sec.gov links. The Filed and Form
 * headers sort, as the Summary's do: the library's `Table` sorts the rows it holds, and the page
 * holds the whole year. Filed sorts by the filing date, then the acceptance time within one
 * day; Form sorts by the form as filed, so `8-K/A` sits after `8-K`.
 *
 * @returns The columns, for the library's `Table`.
 */
export function filingColumns(): Column<Filing>[] {
  return [
    {
      key: 'filed',
      header: 'Filed',
      width: FILING_WIDTHS.filed,
      sortable: true,
      sortAccessor: (filing) => `${filing.filingDate} ${filing.acceptedAt}`,
      cell: (filing) => filing.filingDate,
    },
    {
      key: 'document',
      header: 'Document',
      cell: (filing) => <Entity layout="stack" mono title={filing.primaryDocument} subtitle={filing.accessionNumber} />,
    },
    {
      key: 'form',
      header: 'Form',
      width: FILING_WIDTHS.form,
      sortable: true,
      sortAccessor: (filing) => filing.form,
      cell: (filing) => (
        <Badge tone={filing.isAmendment
          ? 'warning'
          : 'neutral'}
        >
          {filing.form}
        </Badge>
      ),
    },
    {
      key: 'links',
      header: '',
      width: FILING_WIDTHS.links,
      align: 'end',
      cell: (filing) => (
        <Content direction="row" align="center" justify="end" gap="sm">
          <SecLink href={filing.links.document}>{DOCUMENT_LINK_LABEL}</SecLink>
          {filing.links.inlineXbrlViewer !== null && <SecLink href={filing.links.inlineXbrlViewer}>{IX_VIEWER_LABEL}</SecLink>}
        </Content>
      ),
    },
  ];
}
