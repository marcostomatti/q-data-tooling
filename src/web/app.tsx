
import type { IconName } from '@open-tomato/components';

import {
  AppShell,
  AppShellBrand,
  AppShellContent,
  AppShellMain,
  AppShellSidebar,
  AppShellTitle,
  AppShellTopbar,
  Banner,
  Button,
  Monogram,
  SidebarNav,
} from '@open-tomato/components';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { APP } from '../app-config.ts';

import { auth, messageOf, type SessionState } from './api.ts';
import { CompaniesPage } from './pages/companies/index.tsx';
import { COMPANIES_TITLE } from './pages/companies/logic.ts';
import { LoginPage } from './pages/login.tsx';
import { SummaryPage } from './pages/summary/index.tsx';
import { TokensPage } from './pages/tokens.tsx';
import { navigate, usePath } from './router.ts';

/** One page the signed-in app shows, and its place in the nav. */
export interface AppPage {
  readonly path: string
  readonly label: string
  /** The nav entry's icon, by its Lucide name. */
  readonly icon: IconName
  readonly render: () => ReactNode
}

/**
 * The pages behind the sign-in, in nav order. The first is where `/` lands: the summary, whose
 * path and label `APP.landing` holds.
 */
export const PAGES: readonly AppPage[] = [
  { path: APP.landing.path, label: APP.landing.label, icon: 'chart-column-stacked', render: () => <SummaryPage /> },
  { path: '/companies', label: COMPANIES_TITLE, icon: 'building-2', render: () => <CompaniesPage /> },
  { path: '/tokens', label: 'Tokens', icon: 'key-round', render: () => <TokensPage /> },
];

/** The page for a path, or the first page for `/` and for any path the app does not draw. */
export function pageFor(path: string): AppPage {
  const first = PAGES[0];
  if (!first) throw new Error('the app has no pages');
  return PAGES.find((page) => page.path === path) ?? first;
}

/** The props of {@link Shell}: the page on show, its content, and the actions the frame offers. */
export interface ShellProps {
  /** The page on show; its nav entry carries `aria-current="page"` and its label heads the topbar. */
  readonly current: AppPage
  /** Signs the browser out. The shell only calls it; the caller does the request and the redirect. */
  readonly onSignOut: () => void
  /** Moves to a page by its path. Defaults to a history push the app's router listens for. */
  readonly onNavigate?: (path: string) => void
  /** The rendered page. */
  readonly children: ReactNode
}

/**
 * The signed-in frame, composed as the library's default `AppShell` story: a collapsible rail
 * holding the brand from `APP.name` and the nav built from {@link PAGES}, and beside it a topbar
 * with the collapse toggle, the current page's label as the screen's one `h1`, and a sign-out
 * button over the page. Every part is a library export styled by its own variants; the shell
 * passes no class string. The frame fills the viewport (`viewport`), so the stylesheet sizes no
 * root box.
 */
export function Shell({ current, onSignOut, onNavigate = navigate, children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <AppShell viewport>
      <AppShellSidebar collapsed={collapsed}>
        <AppShellBrand
          collapsed={collapsed}
          mark={<Monogram name={APP.name} tone="primary" size="sm" />}
          wordmark={APP.name}
        />
        <SidebarNav
          items={PAGES.map((page) => ({ id: page.path, label: page.label, icon: page.icon }))}
          activeId={current.path}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      </AppShellSidebar>
      <AppShellMain>
        <AppShellTopbar
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((was) => !was)}
        >
          <AppShellTitle>{current.label}</AppShellTitle>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </AppShellTopbar>
        <AppShellContent>{children}</AppShellContent>
      </AppShellMain>
    </AppShell>
  );
}

/** Asks the server whether this browser is signed in, then shows the login page or the app. */
export function App() {
  const path = usePath();
  const [session, setSession] = useState<SessionState | undefined>();
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    try {
      setSession(await auth.session());
    } catch (failure: unknown) {
      setError(messageOf(failure, 'the server did not answer'));
    }
  }, []);

  useEffect(() => {
    // Loads the session on mount. Fire-and-forget: `refresh` catches its own failure into `error`.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the setState calls run after the awaited request, not synchronously in the effect
    void refresh();
  }, [refresh]);

  if (error !== undefined) {
    return (
      <Banner tone="danger" role="alert">
        {error}
      </Banner>
    );
  }
  // The session answers in milliseconds from the same origin, so the wait draws nothing rather
  // than a flash of a loading line.
  if (session === undefined) return null;

  if (!session.signedIn) {
    const oidcError = new URLSearchParams(window.location.search).get('error') === 'oidc';
    return (
      <LoginPage
        mode={session.mode}
        oidcError={oidcError}
        onSignedIn={() => {
          navigate(pageFor('/').path);
          // Fire-and-forget: `refresh` catches its own failure into `error`.
          void refresh();
        }}
      />
    );
  }

  const current = pageFor(path);
  if (path !== current.path) window.history.replaceState(null, '', current.path);
  return (
    <Shell
      current={current}
      onSignOut={() => {
        // Fire-and-forget from a click handler; the chain has no rejection handler of its own.
        void auth.logout().then(() => {
          navigate('/login');
          return refresh();
        });
      }}
    >
      {current.render()}
    </Shell>
  );
}
