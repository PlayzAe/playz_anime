import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/*
 * Path routing: every page has a real URL (/anime/154587, /read/105398/…) that can
 * be shared, bookmarked or opened in a new tab. Every entry carries an index in
 * history.state so the title bar knows whether back/forward are possible and each
 * page can get its scroll position back. Old #/ links from the first web version
 * still land on the right page.
 */

export type RouteName =
  | 'home'
  | 'mangaHome'
  | 'discover'
  | 'schedule'
  | 'library'
  | 'downloads'
  | 'settings'
  | 'anime'
  | 'manga'
  | 'watch'
  | 'read'
  | 'profiles'
  | 'profile'
  | 'notfound';

export interface Route {
  name: RouteName;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** History index of this entry. */
  index: number;
  /** How we arrived here: 'pop' means back/forward, so restore scroll. */
  via: 'push' | 'replace' | 'pop';
}

const PATTERNS: [RouteName, RegExp, string[]][] = [
  ['home', /^\/?$/, []],
  ['discover', /^\/discover\/?$/, []],
  ['schedule', /^\/schedule\/?$/, []],
  ['library', /^\/library\/?$/, []],
  ['downloads', /^\/(?:downloads|app)\/?$/, []],
  ['settings', /^\/settings\/?$/, []],
  ['mangaHome', /^\/manga\/?$/, []],
  ['anime', /^\/anime\/(\d+)\/?$/, ['id']],
  ['manga', /^\/manga\/(\d+)\/?$/, ['id']],
  ['watch', /^\/watch\/(\d+)\/(\d+)\/?$/, ['id', 'ep']],
  // Chapter ids contain ':' and '/', so they travel URI-encoded.
  ['read', /^\/read\/(\d+)\/([^/]+)\/?$/, ['id', 'chapter']],
  ['profiles', /^\/profiles\/?$/, []],
  ['profile', /^\/profiles\/([^/]+)\/?$/, ['id']],
];

/** Encodes one path segment. Dots are escaped too, so no server mistakes a chapter id for a file name. */
export const segment = (value: string) => encodeURIComponent(value).replace(/\./g, '%2E');

function parse(pathname: string, search: string, index: number, via: Route['via']): Route {
  const path = pathname || '/';
  const query = new URLSearchParams(search);
  for (const [name, re, keys] of PATTERNS) {
    const m = re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      try {
        keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      } catch {
        break;
      }
      return { name, path, params, query, index, via };
    }
  }
  return { name: 'notfound', path, params: {}, query, index, via };
}

// When the site is served from a sub-path (a GitHub Pages project site, /playzanime-web/),
// every route lives under it. Routes stay written as /anime/1; these helpers add the prefix.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');
const stripBase = (p: string) => (BASE && p.startsWith(BASE) ? p.slice(BASE.length) || '/' : p);
/** The real address for an in-app route. */
export const href = (to: string) => `${BASE}${to.startsWith('/') ? to : `/${to}`}`;

// A link from the hash-routed version (/#/anime/1) moves onto the real path.
if (location.hash.startsWith('#/')) {
  history.replaceState(history.state, '', href(location.hash.slice(1)));
}
if (typeof history.state?.idx !== 'number') history.replaceState({ idx: 0 }, '');

let index: number = history.state.idx;
let maxIndex = index;
let current = parse(stripBase(location.pathname), location.search, index, 'push');
const listeners = new Set<() => void>();

function emit(via: Route['via']) {
  current = parse(stripBase(location.pathname), location.search, index, via);
  listeners.forEach((l) => l());
}

window.addEventListener('popstate', (e) => {
  index = typeof e.state?.idx === 'number' ? e.state.idx : index + 1;
  if (index > maxIndex) maxIndex = index;
  emit('pop');
});

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = href(to);
  if (target === location.pathname + location.search && !opts.replace) return;
  if (opts.replace) {
    history.replaceState({ idx: index }, '', target);
    emit('replace');
  } else {
    index += 1;
    maxIndex = index;
    history.pushState({ idx: index }, '', target);
    emit('push');
  }
}

export const goBack = () => index > 0 && history.back();
export const goForward = () => index < maxIndex && history.forward();
export const canGoBack = () => index > 0;
export const canGoForward = () => index < maxIndex;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

/** Builds a path with a query string, dropping empty values. */
export function withQuery(path: string, query: Record<string, string | number | null | undefined | false>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== null && v !== undefined && v !== '' && v !== false) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
}

export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return <a href={href(to)} onClick={handle} {...rest} />;
}

/** The browser tab says where you are, so history and shared links read well. */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · PlayzAnime` : 'PlayzAnime';
  }, [title]);
}
