import { Content, EmptyState } from '@open-tomato/components';

/** The Companies page's heading, the same text as its nav entry's label. */
export const COMPANIES_TITLE = 'Companies';

/** What the Companies page's empty state says while the page lists no companies yet. */
export const COMPANIES_EMPTY_TITLE = 'No companies yet';

/** What the Companies page's empty state tells the reader the page will hold. */
export const COMPANIES_EMPTY_DESCRIPTION = 'The tracked companies will be listed here.';

/**
 * The Companies page as a pure view: a page header titled {@link COMPANIES_TITLE}, and the
 * library's `EmptyState` standing in for the company list. The library has no page-header
 * component, so the header is an `h1` in a `Content` row.
 */
export function CompaniesView() {
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="between">
        <h1>{COMPANIES_TITLE}</h1>
      </Content>
      <EmptyState title={COMPANIES_EMPTY_TITLE} description={COMPANIES_EMPTY_DESCRIPTION} />
    </Content>
  );
}

/** The Companies page in the signed-in app: for now it renders {@link CompaniesView} alone. */
export function CompaniesPage() {
  return <CompaniesView />;
}
