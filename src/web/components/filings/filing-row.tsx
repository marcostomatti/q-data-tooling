import type { Filing } from '../../api.ts';

import { Badge, Button, Content, Entity } from '@open-tomato/components';

import { DOCUMENT_LINK_LABEL, IX_VIEWER_LABEL } from './logic.ts';

/**
 * A sec.gov link opening in a new tab with no `window.opener` handed to it, drawn as the
 * library's small `ghost` `Button` over the anchor.
 */
function SecLink({ href, children }: { readonly href: string, readonly children: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    </Button>
  );
}

/** The props of {@link FilingRow}. */
export interface FilingRowProps {
  /** The filing shown. */
  readonly filing: Filing
}

/**
 * One filing in its form's group, as the library's `Entity` in its `stack` layout: the
 * `primaryDocument` in the mono face on the top line, with the links to `links.document` and,
 * when the filing has one, the inline XBRL viewer beside it; the filing date greyed on the line
 * below, led by the form as filed in a `Badge` when it is an amendment.
 *
 * @param props - The filing, as {@link FilingRowProps} lists it.
 * @returns The row.
 */
export function FilingRow({ filing }: FilingRowProps) {
  return (
    <Entity
      layout="stack"
      mono
      title={filing.primaryDocument}
      badge={filing.isAmendment
        ? <Badge tone="warning" size="sm">{filing.form}</Badge>
        : undefined}
      subtitle={filing.filingDate}
      trailing={(
        <Content direction="row" align="center" gap="sm">
          <SecLink href={filing.links.document}>{DOCUMENT_LINK_LABEL}</SecLink>
          {filing.links.inlineXbrlViewer !== null && (
            <SecLink href={filing.links.inlineXbrlViewer}>{IX_VIEWER_LABEL}</SecLink>
          )}
        </Content>
      )}
    />
  );
}
