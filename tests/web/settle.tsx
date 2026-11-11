import type { ReactElement } from 'react';

import * as React from 'react';

/** React's private hook dispatcher slot; a probe stands in it because no DOM is available to run effects. */
const INTERNALS = (React as unknown as Record<string, { H: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown };

/** The most render passes a settle may take before a test calls it a loop. */
const MAX_PASSES = 10;

interface PendingEffect { readonly slot: number, readonly run: () => void | (() => void), readonly deps: readonly unknown[] | undefined }

/** A driven component: its last tree, a `flush` that renders again until quiet, and a `stop` that runs the live cleanups. */
export interface Settled {
  tree: ReactElement<Record<string, unknown>>
  flush: () => Promise<void>
  stop: () => void
}

/**
 * Drives a component with `useState` and `useEffect` and no DOM: renders, runs the effects whose
 * deps changed, lets the promises they started settle, and renders again until nothing changes.
 *
 * @param element - The element to drive; its type is called as a plain function.
 * @returns The driven component, as {@link Settled} lists it.
 */
export async function settle(element: ReactElement<Record<string, unknown>>): Promise<Settled> {
  const state: unknown[] = [];
  const lastDeps: Array<readonly unknown[] | undefined> = [];
  const cleanups: Array<void | (() => void)> = [];
  let pending: PendingEffect[] = [];
  let dirty = false;
  const settled: Settled = {
    tree: element,
    flush: async () => {
      await flush();
    },
    stop: () => cleanups.forEach((cleanup) => typeof cleanup === 'function' && cleanup()),
  };
  async function flush(): Promise<void> {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      let stateSlot = 0;
      let effectSlot = 0;
      dirty = false;
      const previous = INTERNALS.H;
      INTERNALS.H = {
        useState: (init: unknown) => {
          const slot = stateSlot++;
          if (!(slot in state)) state[slot] = typeof init === 'function'
            ? (init as () => unknown)()
            : init;
          return [state[slot], (next: unknown) => {
            const value = typeof next === 'function'
              ? (next as (current: unknown) => unknown)(state[slot])
              : next;
            if (!Object.is(value, state[slot])) dirty = true;
            state[slot] = value;
          }];
        },
        useEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => {
          const slot = effectSlot++;
          const before = lastDeps[slot];
          const changed = deps === undefined || before === undefined || deps.some((dep, index) => !Object.is(dep, before[index]));
          if (changed) pending.push({ slot, run, deps });
        },
      };
      try {
        settled.tree = (element.type as (props: unknown) => ReactElement<Record<string, unknown>>)(element.props);
      } finally {
        INTERNALS.H = previous;
      }
      for (const effect of pending) {
        const cleanup = cleanups[effect.slot];
        if (typeof cleanup === 'function') cleanup();
        lastDeps[effect.slot] = effect.deps;
        cleanups[effect.slot] = effect.run();
      }
      pending = [];
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!dirty) break;
    }
  }
  await flush();
  return settled;
}
