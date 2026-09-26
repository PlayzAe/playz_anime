import { useSyncExternalStore } from 'react';

/** Below this width the rail becomes a bottom tab bar. Keep in step with the CSS breakpoints. */
export const PHONE_QUERY = '(max-width: 760px)';

function subscribe(query: string) {
  return (listener: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  };
}

const cache = new Map<string, (l: () => void) => () => void>();

export function useMedia(query: string): boolean {
  let sub = cache.get(query);
  if (!sub) cache.set(query, (sub = subscribe(query)));
  return useSyncExternalStore(sub, () => window.matchMedia(query).matches);
}

export const useIsPhone = () => useMedia(PHONE_QUERY);
export const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

/** True on touch-first devices, where hover-only controls must stay visible. */
export const useCoarsePointer = () => useMedia('(pointer: coarse)');
