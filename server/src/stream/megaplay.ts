import { parse } from 'node-html-parser';
import { getJson, getText } from '../http';
import { logger } from '../log';
import { assertPublicUrl } from '../proxy/guard';

const log = logger('megaplay');

/*
 * The browserless route. The embed page is a small HTML shell whose player div
 * carries the file id (data-id). The player then calls
 * /stream/getSources?id=<id>, which answers with subtitle tracks, intro/outro
 * marks and the playlist URL in encrypted form ("enc"). The playlist itself is
 * served without a token at <cdn>/anime/<a>/<b>/master.m3u8, and that same
 * /anime/<a>/<b>/ folder is where every subtitle track lives, so the master can
 * be found from the tracks without decrypting anything. When that doesn't work
 * (no tracks, CDN refuses) the caller falls back to a real browser.
 */

export interface SourcesJson {
  tracks?: { file?: string; label?: string; kind?: string; default?: boolean }[];
  intro?: { start?: number; end?: number };
  outro?: { start?: number; end?: number };
  /** Older player versions sent the playlist in the clear. */
  sources?: { file?: string; type?: string }[] | string;
  file?: string;
  enc?: string;
}

export interface DirectResult {
  sources: SourcesJson | null;
  /** The master playlist and its text, when one of the candidates answered. */
  master: string | null;
  masterText: string | null;
}

const PLAYLIST = /\.m3u8(\?|$)/i;

/** The player's file id: data-id on #megaplay-player, else the "File 13461" page title. */
export function playerId(html: string): string | null {
  const root = parse(html);
  const fromDiv = root.querySelector('#megaplay-player')?.getAttribute('data-id') ?? root.querySelector('[data-id]')?.getAttribute('data-id');
  if (fromDiv && /^\d+$/.test(fromDiv)) return fromDiv;
  return /<title>\s*File\s+(\d+)/i.exec(html)?.[1] ?? null;
}

/** The page script appends the embed's own ?s= to getSources; do the same. */
function sourcesUrl(embedUrl: string, id: string): string {
  const embed = new URL(embedUrl);
  const url = new URL('/stream/getSources', embed.origin);
  url.searchParams.set('id', id);
  const s = (embed.searchParams.get('s') ?? '').replace(/[^a-z0-9_-]/gi, '');
  if (s) url.searchParams.set('s', s);
  return url.toString();
}

// The player asks this file which CDN mirror to use when the usual one fails.
let mirror: { at: number; host: string | null } | null = null;

async function fallbackMirror(origin: string): Promise<string | null> {
  if (mirror && Date.now() - mirror.at < 10 * 60_000) return mirror.host;
  const data = await getJson<{ fallback?: string }>(`${origin}/lib/check_domain.json?cache_burst=${Date.now()}`, {
    headers: { Referer: `${origin}/` },
    timeoutMs: 6000,
  }).catch(() => null);
  const host = typeof data?.fallback === 'string' && /^[a-z0-9.-]+$/i.test(data.fallback) ? data.fallback : null;
  mirror = { at: Date.now(), host };
  return host;
}

async function masterCandidates(sources: SourcesJson, origin: string): Promise<string[]> {
  const out: string[] = [];
  const clear = typeof sources.sources === 'string' ? sources.sources : Array.isArray(sources.sources) ? sources.sources[0]?.file : sources.file;
  if (clear && PLAYLIST.test(clear)) out.push(clear);

  const folders = new Set<string>();
  for (const t of sources.tracks ?? []) {
    const m = t.file ? /^(https?:\/\/[^/]+\/.+?)\/(?:subtitles|thumbnails?|sprites?)\//i.exec(t.file) : null;
    if (m) folders.add(m[1]);
  }
  const alt = folders.size ? await fallbackMirror(origin) : null;
  for (const folder of folders) {
    out.push(`${folder}/master.m3u8`);
    if (alt) {
      const u = new URL(`${folder}/master.m3u8`);
      u.host = alt;
      out.push(u.toString());
    }
  }
  return [...new Set(out)].slice(0, 4);
}

async function fetchPlaylist(url: string, referer: string): Promise<string | null> {
  try {
    await assertPublicUrl(url);
    const text = await getText(url, { headers: { Referer: referer, Origin: new URL(referer).origin }, timeoutMs: 10000 });
    return text.trimStart().startsWith('#EXTM3U') ? text : null;
  } catch (err) {
    log.debug(`playlist candidate failed: ${url}`, String(err));
    return null;
  }
}

export async function resolveDirect(embedUrl: string): Promise<DirectResult> {
  const origin = new URL(embedUrl).origin;
  const referer = `${origin}/`;
  const html = await getText(embedUrl, { headers: { Referer: referer }, timeoutMs: 12000 });
  const id = playerId(html);
  if (!id) {
    log.warn(`no player id in ${embedUrl}`);
    return { sources: null, master: null, masterText: null };
  }

  const sources = await getJson<SourcesJson>(sourcesUrl(embedUrl, id), {
    headers: { Referer: embedUrl, 'X-Requested-With': 'XMLHttpRequest' },
    timeoutMs: 10000,
  }).catch((err) => {
    log.warn(`getSources failed for file ${id}:`, String(err));
    return null;
  });
  if (!sources) return { sources: null, master: null, masterText: null };

  for (const candidate of await masterCandidates(sources, origin)) {
    const text = await fetchPlaylist(candidate, referer);
    if (text) return { sources, master: candidate, masterText: text };
  }
  return { sources, master: null, masterText: null };
}
