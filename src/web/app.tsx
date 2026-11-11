
import type { IconName } from '@open-tomato/components';

import {
  AppShell,
  AppShellContent,
  AppShellMain,
  AppShellSidebar,
  AppShellTopbar,
  Button,
  Monogram,
  SidebarNav,
} from '@open-tomato/components';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { APP } from '../app-config.ts';

import { auth, type SessionState } from './api.ts';
import { CompaniesPage } from './pages/companies.tsx';
import { HomePage } from './pages/home.tsx';
import { LoginPage } from './pages/login.tsx';
import { SummaryPage } from './pages/summary.tsx';
import { TokensPage } from './pages/tokens.tsx';

/** One page the signed-in app shows, and its place in the nav. */
export interface AppPage {
  readonly path: string
  readonly label: string
  /** The nav entry's icon, by its Lucide name. */
  readonly icon: IconName
  readonly render: () => ReactNode
}

/** The pages behind the sign-in, in nav order. The first is where `/` lands. */
export const PAGES: readonly AppPage[] = [
  { path: APP.landing.path, label: APP.landing.label, icon: 'house', render: () => <HomePage /> },
  { path: '/companies', label: 'Companies', icon: 'building-2', render: () => <CompaniesPage /> },
  { path: '/summary', label: 'Summary', icon: 'chart-column-stacked', render: () => <SummaryPage /> },
  { path: '/tokens', label: 'Tokens', icon: 'key-round', render: () => <TokensPage /> },
];

/** The page for a path, or the first page for `/` and for any path the app does not draw. */
export function pageFor(path: string): AppPage {
  const first = PAGES[0];
  if (!first) throw new Error('the app has no pages');
  return PAGES.find((page) => page.path === path) ?? first;
}

function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

/**
 * The shell's own classes. The library's `AppShell` story draws its brand row, wordmark, topbar
 * title and spacer with story-only classes the library does not export, so the shell carries
 * the same ones here. The brand row is as tall as the topbar (`h-[60px]`) with the same divider,
 * so the two line up across the frame.
 */
const SHELL_CLASSES = {
  brandRow: 'flex h-[60px] shrink-0 items-center gap-2.5 border-b border-border-soft',
  brandRowOpen: 'justify-start px-[18px]',
  brandRowCollapsed: 'justify-center p-0',
  wordmark: 'font-display text-[17px] font-bold tracking-[-0.02em] text-fg1',
  title: 'font-display text-lg font-bold tracking-[-0.015em] text-fg1',
  spacer: 'flex-1',
} as const;

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
 * with the collapse toggle, the current page's label and a sign-out button over the page.
 */
export function Shell({ current, onSignOut, onNavigate = navigate, children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <AppShell>
      <AppShellSidebar collapsed={collapsed}>
        <div
          className={`${SHELL_CLASSES.brandRow} ${collapsed
            ? SHELL_CLASSES.brandRowCollapsed
            : SHELL_CLASSES.brandRowOpen}`}
        >
          <Monogram name={APP.name} tone="primary" size="sm" />
          {!collapsed && <span className={SHELL_CLASSES.wordmark}>{APP.name}</span>}
        </div>
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
          <span className={SHELL_CLASSES.title}>{current.label}</span>
          <div className={SHELL_CLASSES.spacer} />
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
      setError(failure instanceof Error
        ? failure.message
        : 'the server did not answer');
    }
  }, []);

  useEffect(() => {
    // Loads the session on mount. Fire-and-forget: `refresh` catches its own failure into `error`.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the setState calls run after the awaited request, not synchronously in the effect
    void refresh();
  }, [refresh]);

  if (error !== undefined) return <p className="error page">{error}</p>;
  if (session === undefined) return <p className="muted page">Loading…</p>;

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
