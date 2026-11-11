import {
  AppShell,
  AppShellContent,
  AppShellMain,
  AppShellSidebar,
  AppShellTopbar,
  SidebarNav,
} from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The library's `Icon` calls `useMemo`, and the library takes React as a peer
 * dependency, so it must use this project's copy. If a second copy is
 * resolved, for example from a local checkout linked in place of the published
 * package, the renderer's dispatcher is not the one the hook reads, and
 * rendering throws "Invalid hook call" (or a null-dispatcher TypeError).
 */
const INVALID_HOOK_CALL = /Invalid hook call|reading 'useMemo'|null is not an object/i;

function renderShell(): string {
  return renderToStaticMarkup(
    <AppShell>
      <AppShellSidebar>
        <SidebarNav
          items={[{ id: 'home', label: 'Home Page', icon: 'layout-dashboard' }]}
          activeId="home"
        />
      </AppShellSidebar>
      <AppShellMain>
        <AppShellTopbar onToggleSidebar={() => {}}>Topbar</AppShellTopbar>
        <AppShellContent>Body text</AppShellContent>
      </AppShellMain>
    </AppShell>,
  );
}

describe('library render under bun test', () => {
  test('renders a hook-using AppShell without an invalid hook call', () => {
    let html = '';
    let error: unknown;

    try {
      html = renderShell();
    } catch (caught) {
      error = caught;
    }

    expect(error === undefined
      ? ''
      : String(error)).not.toMatch(INVALID_HOOK_CALL);
    expect(error).toBeUndefined();
    expect(html).toContain('Home Page');
    expect(html).toContain('Topbar');
    expect(html).toContain('Body text');
    expect(html).toContain('data-glyph-pending');
  });
});
