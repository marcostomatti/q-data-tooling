import type { HTMLAttributes } from 'react';

import { appShellTopbar, cn, Icon, IconButton } from '@open-tomato/components';

/** The props of {@link Topbar}: the library `AppShellTopbar`'s own. */
export interface TopbarProps extends HTMLAttributes<HTMLElement> {
  /** Draws the collapse button and is called when it is pressed. */
  readonly onToggleSidebar?: () => void
  /** Whether the sidebar is collapsed, which the button's label names. */
  readonly sidebarCollapsed?: boolean
}

/** The library's `appShellToggle`, which its package does not export. */
const TOGGLE = '-ml-1 shrink-0';

/**
 * The fix: the band's own layer. `appShellTopbar` blurs what is behind the band with
 * `backdrop-filter`, and a backdrop filter makes the band a stacking context at no z-index, so
 * everything inside it, the search's list included, paints in the band's slot. Positioned page
 * content after the band, such as the Companies toolbar's `Segmented`, which is `relative`,
 * paints later and so on top of the open list, whatever the list's own `z-popover`. A position
 * and a z-index lift the band, and the list in it, over the page. 50 stays under the library's
 * layers for what opens over everything, `z-overlay` (1000) and up, which portal to the body.
 */
const TOPBAR_LAYER = 'relative z-50';

/**
 * A local port of the library's `AppShellTopbar` (`@open-tomato/components` 0.2.0) with one
 * change, {@link TOPBAR_LAYER}, so the company search's list opens over the page and not under
 * it. Everything else is the library's: the `appShellTopbar` variant, and the collapse
 * `IconButton` with the `panel-left` icon and its two labels. The fix is meant to move into the
 * library's `appShellTopbar`, and this file to go with it.
 *
 * @param props - The library's props, as {@link TopbarProps} lists them.
 * @returns The topbar.
 */
export function Topbar({ className, onToggleSidebar, sidebarCollapsed = false, children, ...props }: TopbarProps) {
  return (
    <header className={cn(appShellTopbar(), TOPBAR_LAYER, className)} {...props}>
      {onToggleSidebar !== undefined && (
        <IconButton
          className={TOGGLE}
          icon={<Icon name="panel-left" size={18} />}
          label={sidebarCollapsed
            ? 'Expand sidebar'
            : 'Collapse sidebar'}
          onClick={onToggleSidebar}
        />
      )}
      {children}
    </header>
  );
}
