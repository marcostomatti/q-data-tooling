import type { CompanyPage } from '../../api.ts';

import { Banner, Content, EmptyState } from '@open-tomato/components';

import {
  COMPANIES_EMPTY_DESCRIPTION,
  COMPANIES_EMPTY_TITLE,
  COMPANIES_PAGE_SIZE,
  pageCountOf,
} from './logic.ts';
import { CompanyRow, type CompanyRowHandlers } from './row.tsx';
import { CompaniesToolbar, type CompaniesToolbarProps } from './toolbar.tsx';

/** The props of {@link CompaniesView}: the toolbar's and the rows' handlers, the page of companies and the last failure. */
export interface CompaniesViewProps extends Partial<CompaniesToolbarProps>, CompanyRowHandlers {
  /** The page of companies the server answered, unset before the first answer. */
  readonly result?: CompanyPage
  /** Why the last load or change failed, shown as an alert in place of the empty state. */
  readonly error?: string
}

/**
 * The Companies page as a pure view: the {@link CompaniesToolbar}, an alert when the last load
 * or change failed, one {@link CompanyRow} per company on the page, and the library's
 * `EmptyState` while the page holds no company and nothing failed. The title is the shell's
 * topbar `h1`, from the nav label `COMPANIES_TITLE`, so the view draws no heading. Pure: it
 * holds no state and calls no API.
 *
 * @param props - The view's values and handlers, as {@link CompaniesViewProps} lists them.
 * @returns The page.
 */
export function CompaniesView(props: CompaniesViewProps) {
  const { result, error, search = '', selectedOnly = false, onOpenFilings, onSelectedChange } = props;
  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const page = props.page ?? result?.page ?? 1;
  const pageCount = props.pageCount ?? pageCountOf(total, result?.pageSize ?? COMPANIES_PAGE_SIZE);
  return (
    <Content gap="lg">
      <CompaniesToolbar
        {...props}
        search={search}
        selectedOnly={selectedOnly}
        page={page}
        pageCount={pageCount}
        total={total}
      />
      {error !== undefined && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
      {items.length > 0 && (
        <Content gap="sm">
          {items.map((company) => (
            <CompanyRow key={company.ticker} company={company} onOpenFilings={onOpenFilings} onSelectedChange={onSelectedChange} />
          ))}
        </Content>
      )}
      {error === undefined && total === 0 && <EmptyState title={COMPANIES_EMPTY_TITLE} description={COMPANIES_EMPTY_DESCRIPTION} />}
    </Content>
  );
}
