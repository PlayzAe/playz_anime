// What the page runs on, written to <html data-device> so CSS can tell a phone
// held sideways from a narrow desktop window. Layout width still decides tab bar
// against rail; the device decides labels, touch sizing and remote control.

export type Device = 'phone' | 'tablet' | 'tv' | 'desktop';

const TV_UA = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Viera|AFT[A-Z]|Android TV|GoogleTV|CrKey|Roku|AppleTV/i;
const PHONE_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|Mobile.+Firefox/i;
const TABLET_UA = /iPad|Android|Tablet|Silk|Kindle/i;

const OVERRIDE_KEY = 'playzanime:device';
const DEVICES: Device[] = ['phone', 'tablet', 'tv', 'desktop'];

/** `?device=tv` (or phone, tablet, desktop) pins the layout on this browser; `?device=auto` clears it. */
function override(): Device | null {
  try {
    const q = new URLSearchParams(location.search).get('device');
    if (q === 'auto') localStorage.removeItem(OVERRIDE_KEY);
    else if (q && DEVICES.includes(q as Device)) localStorage.setItem(OVERRIDE_KEY, q);
    const v = localStorage.getItem(OVERRIDE_KEY) as Device | null;
    return v && DEVICES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function detectDevice(): Device {
  const forced = override();
  if (forced) return forced;
  const ua = navigator.userAgent;
  if (TV_UA.test(ua)) return 'tv';
  if (PHONE_UA.test(ua)) return 'phone';
  // iPadOS reports a Mac user agent; touch points give it away.
  const touch = matchMedia('(pointer: coarse)').matches || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (TABLET_UA.test(ua) || touch) return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
  return 'desktop';
}

export const device = () => (document.documentElement.dataset.device as Device) || 'desktop';

const TV_BACK = new Set(['GoBack', 'BrowserBack', 'Backspace']);
const TV_BACK_CODES = new Set([461, 10009]); // webOS, Tizen

/** Arrow keys move focus to the nearest control in that direction, for TV remotes. */
function spatialNav(e: KeyboardEvent) {
  const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]');
  if (!typing && (TV_BACK.has(e.key) || TV_BACK_CODES.has(e.keyCode))) {
    e.preventDefault();
    history.back();
    return;
  }
  const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (!dir || typing || e.defaultPrevented || document.querySelector('video:focus')) return;
  const from = (document.activeElement as HTMLElement) ?? document.body;
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])')) {
    if (el === from) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const dx = r.left + r.width / 2 - ax;
    const dy = r.top + r.height / 2 - ay;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 1) continue;
    const across = Math.abs(dx * dir[1] + dy * dir[0]);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    e.preventDefault();
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

export function installDevice() {
  const root = document.documentElement;
  const apply = () => {
    root.dataset.device = detectDevice();
  };
  apply();
  addEventListener('resize', apply);
  addEventListener('keydown', (e) => {
    if (device() === 'tv') spatialNav(e);
  });
}
