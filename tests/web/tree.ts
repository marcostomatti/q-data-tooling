import type { ReactElement } from 'react';

/** An element of a tree read without rendering, its props open to the test. */
export type AnyElement = ReactElement<Record<string, unknown>>;

/**
 * The first element in a tree of unrendered elements that `match` accepts, searching every prop,
 * so an element passed in a slot such as `action` is found as well as a child.
 *
 * @param node - The tree, or any prop value inside it.
 * @param match - Accepts the element sought.
 * @returns The element, or `undefined` when none matches.
 */
export function findElement(node: unknown, match: (element: AnyElement) => boolean): AnyElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return undefined;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return undefined;
  const element = node as AnyElement;
  if (match(element)) return element;
  return findElement(Object.values(element.props), match);
}
