import type { IncomingMessage } from 'node:http';
import { MANGA_PROVIDERS, type MangaProviderId } from '@shared/types';

/**
 * The part of the viewer's settings the server needs. On the desktop these came
 * from store().settings; on the web every request carries them in `x-pz-prefs`,
 * because settings live in the browser.
 */
export interface Prefs {
  hideAdult: boolean;
  dataSaver: boolean;
  mangaProvider: MangaProviderId | 'auto';
  titleLanguage: 'english' | 'romaji';
}

export const DEFAULT_PREFS: Prefs = { hideAdult: true, dataSaver: false, mangaProvider: 'auto', titleLanguage: 'english' };

const PROVIDER_IDS = new Set<string>(MANGA_PROVIDERS.map((p) => p.id));

/** Reads `x-pz-prefs`; anything missing, malformed or unknown falls back to the defaults. */
export function readPrefs(req: IncomingMessage): Prefs {
  const raw = req.headers['x-pz-prefs'];
  if (typeof raw !== 'string' || !raw) return { ...DEFAULT_PREFS };
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...DEFAULT_PREFS };
    parsed = value as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_PREFS };
  }
  const provider = parsed.mangaProvider;
  return {
    hideAdult: typeof parsed.hideAdult === 'boolean' ? parsed.hideAdult : DEFAULT_PREFS.hideAdult,
    dataSaver: typeof parsed.dataSaver === 'boolean' ? parsed.dataSaver : DEFAULT_PREFS.dataSaver,
    mangaProvider: provider === 'auto' || (typeof provider === 'string' && PROVIDER_IDS.has(provider)) ? (provider as Prefs['mangaProvider']) : 'auto',
    titleLanguage: parsed.titleLanguage === 'romaji' ? 'romaji' : 'english',
  };
}
