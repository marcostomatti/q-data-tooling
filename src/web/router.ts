import { useEffect, useState } from 'react';

/**
 * Moves the app to a path without a page load: pushes it onto the history and fires the
 * `popstate` event that {@link usePath} listens for.
 *
 * @param path - The app path to move to, such as `/companies`.
 */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * The browser's current path, kept current across {@link navigate} and the back and forward
 * buttons.
 *
 * @returns The path, such as `/summary`.
 */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}
