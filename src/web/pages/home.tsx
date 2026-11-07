import { Content, EmptyState } from '@open-tomato/components';

import { APP } from '../../app-config.ts';

/** What the landing page's empty state says while the app has no first page of its own. */
export const HOME_EMPTY_TITLE = 'Nothing here yet';

/** Where a clone puts its first page, as the landing page's empty state tells it. */
export const HOME_EMPTY_DESCRIPTION = 'Put the app\'s first page into PAGES in src/web/app.tsx.';

/** The props of {@link HomeView}: the page header's title. */
export interface HomeViewProps {
  /** The page header's title. Defaults to the landing entry's label from `APP.landing.label`. */
  readonly title?: string
}

/**
 * The landing page as a pure view: a page header titled from `APP.landing.label`, and the
 * library's `EmptyState` saying the app's first page goes into `PAGES` in `src/web/app.tsx`.
 * The library (0.1.1) has no page-header component, so the header is an `h1` in a `Content` row.
 */
export function HomeView({ title = APP.landing.label }: HomeViewProps) {
  return (
    <Content gap="lg">
      <Content direction="row" align="center" justify="between">
        <h1>{title}</h1>
      </Content>
      <EmptyState title={HOME_EMPTY_TITLE} description={HOME_EMPTY_DESCRIPTION} />
    </Content>
  );
}

/** The landing page behind the sign-in: a placeholder a clone replaces with its own first page. */
export function HomePage() {
  return <HomeView />;
}
