import type { ResolvedStream, StreamVariant, SubtitleTrack, TimeRange } from '@shared/types';
import { TtlCache } from '../cache';
import { getJson, getText } from '../http';
import { logger } from '../log';
import { assertPublicUrl } from '../proxy/guard';
import { captureFromEmbed } from './browser';
import { resolveDirect, type SourcesJson } from './megaplay';

const log = logger('stream');
const cache = new TtlCache(100);

/** How long a resolved stream is reused. The CDN links stay valid well beyond this. */
const STREAM_TTL = 5 * 60_000;

export type ResolveRoute = 'direct' | 'browser';

export interface Resolved {
  stream: ResolvedStream;
  /** The Referer every playlist, segment and subtitle request needs. */
  referer: string;
  via: ResolveRoute;
}

// ── Playlist & metadata parsing (as on the desktop) ─────────────────────────

function withToken(url: string, master: string): string {
  const token = /[?&]token=([^&]+)/.exec(master)?.[1];
  if (!token || url.includes('?')) return url;
  return `${url}?token=${token}`;
}

function qualityLabel(height: number, bandwidth: number): { label: string; height: number } {
  let h = height;
  if (!h) {
    const kbps = bandwidth / 1000;
    h = kbps >= 3500 ? 1080 : kbps >= 1500 ? 720 : kbps >= 800 ? 480 : 360;
  }
  const tiers = [2160, 1440, 1080, 720, 480, 360, 240];
  const tier = tiers.find((t) => h >= t * 0.9) ?? h;
  return { label: `${tier}p`, height: tier };
}

function parseMasterText(text: string, master: string): StreamVariant[] {
  if (!text.includes('#EXT-X-STREAM-INF')) {
    // Already a media playlist: a single quality.
    return [{ label: 'Auto', height: 0, bandwidth: 0, url: master }];
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const variants: StreamVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = lines[i + 1];
    if (!uri || uri.startsWith('#')) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
    const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? 0);
    const q = qualityLabel(res ? Number(res[2]) : 0, bw);
    variants.push({ label: q.label, height: q.height, bandwidth: bw, url: withToken(new URL(uri, master).toString(), master) });
  }
  variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  // Drop duplicate tiers (same height, lower bitrate).
  return variants.filter((v, i) => i === 0 || v.label !== variants[i - 1].label);
}

const LANGS: Record<string, string> = {
  eng: 'English', en: 'English', spa: 'Spanish', es: 'Spanish', ger: 'German', deu: 'German', de: 'German',
  ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese', rus: 'Russian', ru: 'Russian',
  ara: 'Arabic', ar: 'Arabic', fra: 'French', fre: 'French', fr: 'French', jpn: 'Japanese', ja: 'Japanese',
  ind: 'Indonesian', id: 'Indonesian', tha: 'Thai', vie: 'Vietnamese', may: 'Malay', msa: 'Malay',
};

function labelFromUrl(url: string): string {
  const m = /\/([a-z]{2,3})(?:-\d+)?\.(?:vtt|srt)/i.exec(url.toLowerCase());
  return (m && LANGS[m[1]]) || 'English';
}

/** "Portuguese (- Portuguese(Brazil))" → "Portuguese (Brazil)" */
function tidyLabel(label: string): string {
  return label
    .replace(/\(\s*-\s*[^()]*\(([^)]+)\)\s*\)/, '($1)')
    .replace(/\s+-\s+\w+\s*\(([^)]+)\)$/, ' ($1)')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function uniqueLabels(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const counts = new Map<string, number>();
  return tracks.map((raw) => {
    const t = { ...raw, label: tidyLabel(raw.label) };
    const n = (counts.get(t.label) ?? 0) + 1;
    counts.set(t.label, n);
    return n === 1 ? t : { ...t, label: `${t.label} ${n}` };
  });
}

function range(r?: { start?: number; end?: number }): TimeRange | null {
  if (!r || typeof r.start !== 'number' || typeof r.end !== 'number' || r.end <= r.start) return null;
  return { start: r.start, end: r.end };
}

async function readSources(url: string, embedUrl: string): Promise<SourcesJson | null> {
  try {
    await assertPublicUrl(url);
    return await getJson<SourcesJson>(url, {
      headers: { Referer: embedUrl, 'X-Requested-With': 'XMLHttpRequest' },
      timeoutMs: 8000,
    });
  } catch (err) {
    log.debug('getSources failed', String(err));
    return null;
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

interface Found {
  master: string;
  masterText: string | null;
  sources: SourcesJson | null;
  capturedSubs: string[];
  via: ResolveRoute;
}

async function find(embedUrl: string, referer: string): Promise<Found> {
  // 1. Plain HTTP: embed page → getSources → playlist folder. Two small requests, no browser.
  const direct = await resolveDirect(embedUrl).catch((err) => {
    log.warn(`direct resolve failed for ${embedUrl}:`, String(err));
    return null;
  });
  if (direct?.master) {
    return { master: direct.master, masterText: direct.masterText, sources: direct.sources, capturedSubs: [], via: 'direct' };
  }

  // 2. A headless browser plays the embed and we note what it requests, as the desktop does.
  log.info(`falling back to the browser for ${embedUrl}`);
  const captured = await captureFromEmbed(embedUrl);
  // Prefer a master playlist over a media playlist when both were requested.
  let master = captured.playlists.find((u) => /master|playlist|index/i.test(u)) ?? captured.playlists[0];
  let masterText: string | null = null;
  // The player's copy carries a token that expires within minutes. The same playlist
  // is served without it, which keeps a cached stream playable for its whole lifetime.
  if (/[?&]token=/.test(master)) {
    const bare = master.split('?')[0];
    const text = await assertPublicUrl(bare)
      .then(() => getText(bare, { headers: { Referer: referer }, timeoutMs: 10000 }))
      .catch(() => null);
    if (text?.trimStart().startsWith('#EXTM3U')) {
      master = bare;
      masterText = text;
    }
  }
  const sources = direct?.sources ?? (captured.getSources ? await readSources(captured.getSources, embedUrl) : null);
  return { master, masterText, sources, capturedSubs: captured.subtitles, via: 'browser' };
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Raw upstream URLs; the RPC layer turns them into signed proxy URLs. */
export function resolveStream(embedUrl: string, force = false): Promise<Resolved> {
  return cache.wrap(
    `stream:${embedUrl}`,
    STREAM_TTL,
    async () => {
      const started = Date.now();
      const referer = `${new URL(embedUrl).origin}/`;
      const found = await find(embedUrl, referer);
      const { master, sources } = found;
      await assertPublicUrl(master);

      let variants: StreamVariant[];
      try {
        const text = found.masterText ?? (await getText(master, { headers: { Referer: referer }, timeoutMs: 12000 }));
        variants = parseMasterText(text, master);
      } catch (err) {
        log.warn('master parse failed', String(err));
        variants = [{ label: 'Auto', height: 0, bandwidth: 0, url: master }];
      }

      const subtitles: SubtitleTrack[] = [];
      for (const t of sources?.tracks ?? []) {
        if (!t.file || (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles')) continue;
        const generic = !t.label || ['subtitles', 'default', 'cc', 'caption'].includes(t.label.toLowerCase());
        subtitles.push({ label: generic ? labelFromUrl(t.file) : t.label!.trim(), url: t.file, isDefault: !!t.default });
      }
      for (const u of found.capturedSubs) {
        if (!subtitles.some((s) => s.url === u)) subtitles.push({ label: labelFromUrl(u), url: u });
      }

      log.info(`resolved ${embedUrl} via ${found.via} in ${Date.now() - started}ms (${variants.length} variants, ${subtitles.length} subs)`);
      return {
        via: found.via,
        referer,
        stream: {
          embedUrl,
          master,
          host: new URL(master).host,
          variants,
          subtitles: uniqueLabels(subtitles),
          intro: range(sources?.intro),
          outro: range(sources?.outro),
          resolvedAt: Date.now(),
        },
      };
    },
    force,
  );
}

export function clearStreamCache() {
  cache.clear();
}
