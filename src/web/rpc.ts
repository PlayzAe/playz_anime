import type { Settings } from '../shared/types';
import { settings } from './storage';

/*
 * The server side of window.playzanime: POST /api/rpc/<channel> with { args }.
 * Every call carries the viewer's preferences, because the server uses them
 * wherever the desktop read its own settings (adult filtering, data saver pages,
 * the preferred manga source, title language).
 */

const TIMEOUT_MS = 90_000;

type Prefs = Pick<Settings, 'hideAdult' | 'dataSaver' | 'mangaProvider' | 'titleLanguage'>;

export function prefsHeader(): string {
  const s = settings();
  const prefs: Prefs = { hideAdult: s.hideAdult, dataSaver: s.dataSaver, mangaProvider: s.mangaProvider, titleLanguage: s.titleLanguage };
  return JSON.stringify(prefs);
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) return AbortSignal.timeout(ms);
  return undefined;
}

// Empty: the server is on the same address (start.bat, Vercel). A GitHub Pages build sets
// VITE_API_BASE to wherever the server runs, e.g. https://playzanime-web.vercel.app.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
export const hasApiBase = Boolean(API_BASE);

export async function rpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/rpc/${channel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pz-prefs': prefsHeader() },
      body: JSON.stringify({ args }),
      signal: timeoutSignal(TIMEOUT_MS),
    });
  } catch (err) {
    // Worded so the UI's error helper recognises it as a connection problem.
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new Error(timedOut ? 'The request timed out.' : 'fetch failed: PlayzAnime couldn’t reach its server.');
  }

  const text = await res.text().catch(() => '');
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }
  if (!res.ok) {
    const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}
