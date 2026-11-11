import { Drawer, Modal } from '@open-tomato/components';

import { FilingsPanel, type FilingsPanelProps } from './panel.tsx';

/**
 * The modal's full-screen frame. `Modal` sizes stop at `lg`, 620px wide, so this one class string
 * stretches its panel over the viewport; `cn` in the library merges it over the size's width.
 */
const FULL_SCREEN_MODAL = 'h-dvh max-h-dvh w-screen rounded-none border-0';

/** The props of {@link FilingsView}: the panel's, and the ticker and close handler of the overlay. */
export interface FilingsViewProps extends FilingsPanelProps {
  /** The ticker of the company shown, the title until the company's name arrives. */
  readonly ticker: string
  /** Whether the overlay is open. */
  readonly open: boolean
  /** Closes the overlay. */
  readonly onClose: () => void
}

/**
 * The filings view as a pure view: the {@link FilingsPanel} in the library's right-side `Drawer`
 * at its `lg` size (option B), or in a full-screen `Modal` (option A), as `layout` names. The
 * company's name is the title and its ticker the eyebrow.
 *
 * @param props - The view's values and handlers, as {@link FilingsViewProps} lists them.
 * @returns The drawer or the modal.
 */
export function FilingsView(props: FilingsViewProps) {
  const { ticker, open, onClose, layout, result } = props;
  const title = result?.company.name ?? ticker;
  const panel = <FilingsPanel {...props} />;
  return layout === 'drawer'
    ? (
      <Drawer open={open} onClose={onClose} title={title} eyebrow={ticker} size="lg">
        {panel}
      </Drawer>
    )
    : (
      <Modal open={open} onClose={onClose} title={title} eyebrow={ticker} className={FULL_SCREEN_MODAL}>
        {panel}
      </Modal>
    );
}
