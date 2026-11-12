import type { PageSlot } from '../../src/web/components/ports/page-slots.ts';
import type { ReactElement } from 'react';

import { appShellTopbar, IconButton } from '@open-tomato/components';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PAGE_SIBLINGS, pageSlots } from '../../src/web/components/ports/page-slots.ts';
import { Pagination } from '../../src/web/components/ports/pagination.tsx';
import { Topbar } from '../../src/web/components/ports/topbar.tsx';

import { findElement } from './tree.ts';

/** The slots as text: each page counted from 1, each gap as `…`. */
function spelled(slots: readonly PageSlot[]): string {
  return slots.map((slot) => (slot.kind === 'gap'
    ? '…'
    : String(slot.index + 1))).join(' ');
}

describe('pageSlots', () => {
  test('lists every page while seven fit, one sibling each side', () => {
    expect(PAGE_SIBLINGS).toBe(1);
    expect(spelled(pageSlots(1, 0))).toBe('1');
    expect(spelled(pageSlots(7, 3))).toBe('1 2 3 4 5 6 7');
  });

  test('near the start, shows the first five, a gap and the last', () => {
    expect(spelled(pageSlots(321, 0))).toBe('1 2 3 4 5 … 321');
    expect(spelled(pageSlots(321, 3))).toBe('1 2 3 4 5 … 321');
  });

  test('in the middle, shows the first, a gap, the page with a sibling each side, a gap and the last', () => {
    expect(spelled(pageSlots(321, 4))).toBe('1 … 4 5 6 … 321');
    expect(spelled(pageSlots(321, 159))).toBe('1 … 159 160 161 … 321');
  });

  test('near the end, shows the first, a gap and the last five', () => {
    expect(spelled(pageSlots(321, 320))).toBe('1 … 317 318 319 320 321');
    expect(spelled(pageSlots(321, 317))).toBe('1 … 317 318 319 320 321');
  });

  test('keeps seven slots wherever the page is, so the buttons do not jump', () => {
    for (let index = 0; index < 40; index += 1) {
      expect(pageSlots(40, index)).toHaveLength(7);
    }
  });

  test('the two gaps of one list have keys of their own', () => {
    const gaps = pageSlots(321, 159).filter((slot) => slot.kind === 'gap');
    expect(gaps).toEqual([{ kind: 'gap', side: 'start' }, { kind: 'gap', side: 'end' }]);
  });
});

describe('the Pagination port', () => {
  test('draws a windowed list of a long count, the current page marked', () => {
    const html = renderToStaticMarkup(<Pagination count={321} index={159} />);
    expect(html.match(/<button/g)).toHaveLength(7);
    expect(html).toMatch(/aria-current="page"[^>]*>160<\/button>/);
    expect(html).toContain('>321</button>');
    expect(html.match(/>…<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain('>100</button>');
  });

  test('keeps the library\'s arrows, disabled at each end', () => {
    const first = renderToStaticMarkup(<Pagination count={3} index={0} />);
    expect(first).toMatch(/<button[^>]*aria-label="Previous"[^>]*disabled=""/);
    expect(first).not.toMatch(/<button[^>]*aria-label="Next"[^>]*disabled=""/);
    const last = renderToStaticMarkup(<Pagination count={3} index={2} />);
    expect(last).toMatch(/<button[^>]*aria-label="Next"[^>]*disabled=""/);
  });

  test('asks for the page a button holds, counted from 0', () => {
    const asked: number[] = [];
    const tree = Pagination({ count: 321, index: 0, onChange: (index) => asked.push(index) });
    const last = findElement(tree, (element) => element.type === 'button' && element.props.children === 321);
    (last?.props.onClick as () => void)();
    expect(asked).toEqual([320]);
  });
});

describe('the Topbar port', () => {
  test('is the library band with a layer of its own, so the search list opens over the page', () => {
    const tree = Topbar({ children: 'Title' }) as ReactElement<{ className: string }>;
    expect(tree.type).toBe('header');
    expect(tree.props.className.startsWith(appShellTopbar())).toBe(true);
    expect(tree.props.className).toContain('relative z-50');
  });

  test('draws the collapse button only with a handler, labelled for the state it toggles', () => {
    expect(findElement(Topbar({}), (element) => element.type === IconButton)).toBeUndefined();
    const open = findElement(Topbar({ onToggleSidebar: () => undefined }), (element) => element.type === IconButton);
    const closed = findElement(Topbar({ onToggleSidebar: () => undefined, sidebarCollapsed: true }), (element) => element.type === IconButton);
    expect(open?.props.label).toBe('Collapse sidebar');
    expect(closed?.props.label).toBe('Expand sidebar');
  });
});
