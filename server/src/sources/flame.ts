import type { Chapter, ChapterPage } from '@shared/types';
import { getJson, getText, retry } from '../http';
import { decodeEntities } from './anikoto';

/*
 * Flame Comics: a scanlation group focused on current Korean manhwa, often the only
 * English source for new series. Its whole catalogue is one small JSON list, and
 * chapter lists and page images are embedded in the series and chapter pages.
 */

const DOMAINS = ['https://flamecomics.xyz', 'https://flamecomics.com'];
let activeBase = DOMAINS[0];
export const FLAME_REFERER = `${activeBase}/`;

interface FlameSeries {
  id: number;
  label: string;
  status: string;
  chapter_count: string;
}

// "A Regressor's Tale" and "Regressor's Tale" are the same series; leading articles don't count.
const norm = (s: string) => s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9]/g, '');

let catalogue: { at: number; list: FlameSeries[] } | null = null;

async function list(): Promise<FlameSeries[]> {
  if (catalogue && Date.now() - catalogue.at < 6 * 3_600_000) return catalogue.list;
  let lastErr: unknown;
  for (const domain of DOMAINS) {
    try {
      const data = await retry(() =>
        getJson<FlameSeries[]>(`${domain}/api/series`, {
          timeoutMs: 15000,
          headers: { Referer: `${domain}/`, Accept: 'application/json, text/plain, */*' },
        }),
      );
      if (Array.isArray(data) && data.length) {
        activeBase = domain;
        catalogue = { at: Date.now(), list: data };
        return catalogue.list;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Flame Comics unreachable');
}

export async function match(titles: string[]): Promise<{ id: string; title: string } | null> {
  const wanted = new Set(titles.map(norm).filter(Boolean));
  const hit = (await list()).find((s) => wanted.has(norm(decodeEntities(s.label))));
  return hit ? { id: String(hit.id), title: decodeEntities(hit.label) } : null;
}

export async function chapters(seriesId: string): Promise<Chapter[]> {
  const html = await retry(() => getText(`${activeBase}/series/${seriesId}`, { timeoutMs: 20000, headers: { Referer: `${activeBase}/` } }));
  const seen = new Set<string>();
  const list: Chapter[] = [];
  for (const chunk of html.split('"chapter_id":').slice(1)) {
    const head = chunk.slice(0, 600);
    const token = /"token":"([a-f0-9]+)"/.exec(head)?.[1];
    const raw = /"chapter":"([^"]+)"/.exec(head)?.[1];
    if (!token || seen.has(token) || !head.includes(`"series_id":${seriesId},`)) continue;
    seen.add(token);
    const title = /"title":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
    const released = Number(/"release_date":(\d+)/.exec(head)?.[1]);
    const n = Number(raw);
    list.push({
      id: `flame:${seriesId}/${token}`,
      provider: 'flame',
      number: raw ? (Number.isFinite(n) ? String(n) : raw) : null,
      title: title ? decodeEntities(JSON.parse(`"${title}"`)) : null,
      volume: null,
      group: 'Flame Comics',
      pages: null,
      publishedAt: released ? released * 1000 : null,
      externalUrl: null,
    });
  }
  return list.sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0));
}

/** Page image URLs; the CDN wants the site as Referer, so the RPC layer proxies them. */
export async function pages(sourceId: string): Promise<ChapterPage[]> {
  const [seriesId, token] = sourceId.split('/');
  const html = await retry(() => getText(`${activeBase}/series/${seriesId}/${token}`, { timeoutMs: 15000, headers: { Referer: `${activeBase}/` } }));
  // Only this chapter's folder: the site mixes in its own "read on Flame" promo panels.
  const re = new RegExp(`https://cdn\\.flamecomics\\.xyz/uploads/images/series/${seriesId}/${token}/[^"\\\\\\s?]+(?:\\?\\d+)?`, 'g');
  const urls = [...new Set(html.match(re) ?? [])];
  return urls.map((url) => ({ url }));
}

export async function ping(): Promise<void> {
  catalogue = null;
  await list();
}
