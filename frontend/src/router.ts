import { useEffect, useState } from 'react';

// A path router small enough to own: /, /projects, /p/:pid, /p/:pid/d/:did.

export type Route =
  | { name: 'home' }
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'canvas'; projectId: string; diagramId: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'projects') return { name: 'projects' };
  if (parts[0] === 'p' && parts[1]) {
    if (parts[2] === 'd' && parts[3]) return { name: 'canvas', projectId: parts[1], diagramId: parts[3] };
    return { name: 'project', projectId: parts[1] };
  }
  return { name: 'home' };
}

const listeners = new Set<() => void>();

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (window.location.pathname === path) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  listeners.forEach(l => l());
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const update = (): void => setRoute(parseRoute(window.location.pathname));
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return route;
}

// Intercept plain left-clicks on in-app anchors so they do not reload the page.
export function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = event.currentTarget.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  event.preventDefault();
  navigate(href);
}
