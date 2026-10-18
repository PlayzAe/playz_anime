import { device } from './device';

/*
 * Two ways to use the site: the phone layout (src/mobile, built after the Android app)
 * and the computer layout (everything else in src/renderer). Each browser is asked once;
 * Settings → View switches. `?view=mobile` or `?view=desktop` switches for testing.
 */

export type ViewMode = 'mobile' | 'desktop';

const KEY = 'playzanime:view';
const JUST_PICKED = 'playzanime:view-picked';

export function storedView(): ViewMode | null {
  try {
    const q = new URLSearchParams(location.search).get('view');
    if (q === 'mobile' || q === 'desktop') localStorage.setItem(KEY, q);
    const v = localStorage.getItem(KEY);
    return v === 'mobile' || v === 'desktop' ? v : null;
  } catch {
    return null;
  }
}

/** What the picker highlights before anyone chooses. */
export const suggestedView = (): ViewMode => (device() === 'phone' || device() === 'tablet' ? 'mobile' : 'desktop');

/** Saves the choice. The two layouts are separate apps, so switching reloads the page. */
export function chooseView(view: ViewMode, opts: { first?: boolean; reload?: boolean } = {}) {
  try {
    localStorage.setItem(KEY, view);
    if (opts.first) sessionStorage.setItem(JUST_PICKED, view);
  } catch {
    /* private storage: the picker shows again next visit */
  }
  if (opts.reload) location.reload();
}

/** True once, right after the first pick, so the app can say where to change it. */
export function takeJustPicked(): boolean {
  try {
    const v = sessionStorage.getItem(JUST_PICKED);
    sessionStorage.removeItem(JUST_PICKED);
    return v !== null;
  } catch {
    return false;
  }
}

export const viewName = (v: ViewMode) => (v === 'mobile' ? 'Phone view' : 'Computer view');
