import { useEffect, useState, useSyncExternalStore } from 'react';
import { DESKTOP_REPO, RELEASES_URL } from './links';

/*
 * Which app to offer depends on the operating system:
 *   android  the APK from the latest release, or the browser's own install prompt
 *   ios      Share, then Add to Home Screen (Safari has no install prompt)
 *   windows  the Windows installer from the latest release
 *   other    the browser's install prompt where it has one
 * `?os=ios` (or android, windows, mac, linux) pins the OS on this browser for testing;
 * `?os=auto` clears it.
 */

export type OS = 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other';

const OS_KEY = 'playzanime:os';
const OSES: OS[] = ['android', 'ios', 'windows', 'mac', 'linux', 'other'];

export function detectOS(): OS {
  try {
    const q = new URLSearchParams(location.search).get('os');
    if (q === 'auto') localStorage.removeItem(OS_KEY);
    else if (q && OSES.includes(q as OS)) localStorage.setItem(OS_KEY, q);
    const v = localStorage.getItem(OS_KEY) as OS | null;
    if (v && OSES.includes(v)) return v;
  } catch {
    /* storage unavailable */
  }
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS reports a Mac user agent; touch points give it away.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Linux|CrOS/i.test(ua)) return 'linux';
  return 'other';
}

/** Already running as an installed app (home-screen shortcut or installed PWA). */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;

// ── The browser's install prompt ───────────────────────────────────────────

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Run once at boot: the prompt event fires early and only once per page. */
export function installPwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    addEventListener('load', () => {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
    });
  }
}

/** True while the browser will show its own "Install app" dialog on request. */
export const useCanInstall = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
  );

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

// ── Latest release downloads ───────────────────────────────────────────────

export interface Release {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  assets?: { name: string; browser_download_url: string }[];
}

let releasePromise: Promise<Release | null> | null = null;

export function latestRelease(): Promise<Release | null> {
  releasePromise ??= fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? (r.json() as Promise<Release>) : null))
    .catch(() => null);
  return releasePromise;
}

/** Direct links to the APK and the Windows installer, falling back to the release page. */
export function downloadsOf(release: Release | null) {
  const find = (re: RegExp) => release?.assets?.find((a) => re.test(a.name))?.browser_download_url;
  const page = release?.html_url ?? RELEASES_URL;
  const apk = find(/universal\.apk$/i) ?? find(/\.apk$/i);
  return {
    apk: apk ?? page,
    apkVersion: apk?.match(/-(\d+\.\d+\.\d+)/)?.[1] ?? null,
    windows: find(/Setup.*\.exe$/i) ?? find(/\.exe$/i) ?? page,
    page,
  };
}

export function useDownloads() {
  const [release, setRelease] = useState<Release | null>(null);
  useEffect(() => {
    let live = true;
    void latestRelease().then((r) => live && setRelease(r));
    return () => {
      live = false;
    };
  }, []);
  return downloadsOf(release);
}
