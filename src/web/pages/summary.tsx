import { Content, EmptyState } from '@open-tomato/components';

/** The Summary page's heading, which is also its nav label. */
export const SUMMARY_TITLE = 'Summary';

/** What the Summary page's empty state says before its content is built. */
export const SUMMARY_EMPTY_TITLE = 'Nothing here yet';

/** What the Summary page will show, as its empty state tells the reader. */
export const SUMMARY_EMPTY_DESCRIPTION = 'The filings of the selected companies, summed up by form.';

/**
 * The Summary page as a pure view: a page header titled {@link SUMMARY_TITLE} and the library's
 * `EmptyState`. The library has no page-header component, so the header is an `h1` in a
 * `Content` row.
 */
export function SummaryView() {
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="between">
        <h1>{SUMMARY_TITLE}</h1>
      </Content>
      <EmptyState title={SUMMARY_EMPTY_TITLE} description={SUMMARY_EMPTY_DESCRIPTION} />
    </Content>
  );
}

/** The Summary page at `/summary`: the filings of the selected companies, summed up by form. */
export function SummaryPage() {
  return <SummaryView />;
}
