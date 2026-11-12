
import type { IconName, ThemeName } from '@open-tomato/components';

import {
  AppShell,
  AppShellBrand,
  AppShellContent,
  AppShellMain,
  AppShellSidebar,
  AppShellTitle,
  Banner,
  Button,
  Monogram,
  SidebarNav,
  ThemeSwitcher,
} from '@open-tomato/components';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { APP } from '../app-config.ts';

import { auth, messageOf, type SessionState } from './api.ts';
import { CompanySearch } from './components/company-search/index.tsx';
import { Topbar } from './components/ports/topbar.tsx';
import { CompaniesPage } from './pages/companies/index.tsx';
import { COMPANIES_TITLE } from './pages/companies/logic.ts';
import { FilingsPage } from './pages/filings/index.tsx';
import { cikFromPath, FILINGS_PATH, FILINGS_TITLE, filingsPathOf } from './pages/filings/logic.ts';
import { LoginPage } from './pages/login.tsx';
import { SummaryPage } from './pages/summary/index.tsx';
import { TokensPage } from './pages/tokens.tsx';
import { navigate, usePath } from './router.ts';
import { useTheme } from './theme.ts';

/** One page the signed-in app shows, and its place in the nav. */
export interface AppPage {
  readonly path: string
  readonly label: string
  /** The nav entry's icon, by its Lucide name. */
  readonly icon: IconName
  /** Draws the page for the browser's path, which may run past `path`, as `/filings/320193` does. */
  readonly render: (path: string) => ReactNode
}

/**
 * The pages behind the sign-in, in nav order. The first is where `/` lands: the summary, whose
 * path and label `APP.landing` holds.
 */
export const PAGES: readonly AppPage[] = [
  { path: APP.landing.path, label: APP.landing.label, icon: 'chart-column-stacked', render: () => <SummaryPage /> },
  {
    path: FILINGS_PATH,
    label: FILINGS_TITLE,
    icon: 'file-text',
    // One page per CIK, so a new company starts on its first page with no filter.
    render: (path) => {
      const cik = cikFromPath(path);
      return <FilingsPage key={cik ?? 'none'} cik={cik} />;
    },
  },
  { path: '/companies', label: COMPANIES_TITLE, icon: 'building-2', render: () => <CompaniesPage /> },
  { path: '/tokens', label: 'Tokens', icon: 'key-round', render: () => <TokensPage /> },
];

/**
 * Whether the page draws the path: its own path, or a path under it, as `/filings/320193` is
 * under `/filings`. `/filingsx` is under no page.
 *
 * @param page - The page.
 * @param path - The browser's path.
 * @returns `true` when the page draws the path.
 */
export function drawsPath(page: AppPage, path: string): boolean {
  return path === page.path || path.startsWith(`${page.path}/`);
}

/** The page for a path, or the first page for `/` and for any path the app does not draw. */
export function pageFor(path: string): AppPage {
  const first = PAGES[0];
  if (!first) throw new Error('the app has no pages');
  return PAGES.find((page) => drawsPath(page, path)) ?? first;
}

/** The props of {@link Shell}: the page on show, its content, and the actions the frame offers. */
export interface ShellProps {
  /** The page on show; its nav entry carries `aria-current="page"` and its label heads the topbar. */
  readonly current: AppPage
  /** Signs the browser out. The shell only calls it; the caller does the request and the redirect. */
  readonly onSignOut: () => void
  /** Moves to a page by its path. Defaults to a history push the app's router listens for. */
  readonly onNavigate?: (path: string) => void
  /** The theme on show, which the topbar switch offers to flip. Light when unset. */
  readonly theme?: ThemeName
  /** Shows the theme the switch picked; the caller stores it. */
  readonly onThemeChange?: (next: ThemeName) => void
  /** The rendered page. */
  readonly children: ReactNode
}

/**
 * The signed-in frame, composed as the library's default `AppShell` story: a collapsible rail
 * holding the brand from `APP.name` and the nav built from {@link PAGES}, and beside it a topbar
 * with the collapse toggle, the current page's label as the screen's one `h1`, the company
 * search, which opens a company's filings, the theme switch and a sign-out button over the page.
 * Every part is a library export styled by its own variants, but the topbar, the local
 * {@link Topbar} port that lifts the band over the page so the search's list opens on top; the
 * shell passes no class string. The frame fills the viewport (`viewport`), so the stylesheet sizes no
 * root box.
 */
export function Shell({ current, onSignOut, onNavigate = navigate, theme = 'light', onThemeChange, children }: ShellProps) {
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
        <Topbar
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((was) => !was)}
        >
          <AppShellTitle>{current.label}</AppShellTitle>
          <CompanySearch onPick={(cik) => onNavigate(filingsPathOf(cik))} />
          <ThemeSwitcher theme={theme} onToggle={onThemeChange} />
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </Topbar>
        <AppShellContent>{children}</AppShellContent>
      </AppShellMain>
    </AppShell>
  );
}

/** Asks the server whether this browser is signed in, then shows the login page or the app. */
export function App() {
  const path = usePath();
  const [theme, setTheme] = useTheme();
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
  if (!drawsPath(current, path)) window.history.replaceState(null, '', current.path);
  return (
    <Shell
      current={current}
      theme={theme}
      onThemeChange={setTheme}
      onSignOut={() => {
        // Fire-and-forget from a click handler; the chain has no rejection handler of its own.
        void auth.logout().then(() => {
          navigate('/login');
          return refresh();
        });
      }}
    >
      {current.render(path)}
    </Shell>
  );
}
