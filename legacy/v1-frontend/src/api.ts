import type {
  AnimeMedia,
  SeriesDetailResponse,
  CdnStatus,
  DownloadStatus
} from './types';

export interface PaginationResult<T> {
  results: T[];
  page: number;
  hasNextPage: boolean;
}

const CLIENT_CACHE = new Map<string, { time: number; data: unknown }>();
const CLIENT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function getClientCached<T>(key: string): T | null {
  const mem = CLIENT_CACHE.get(key);
  if (mem && (Date.now() - mem.time < CLIENT_CACHE_TTL)) {
    return mem.data as T;
  }
  try {
    const raw = sessionStorage.getItem(`playzae_cache_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.time < CLIENT_CACHE_TTL) {
        CLIENT_CACHE.set(key, parsed);
        return parsed.data as T;
      }
    }
  } catch {}
  return null;
}

export function setClientCached(key: string, data: unknown) {
  const item = { time: Date.now(), data };
  CLIENT_CACHE.set(key, item);
  try {
    sessionStorage.setItem(`playzae_cache_${key}`, JSON.stringify(item));
  } catch {}
}

export async function fetchTrendingAnime(
  genre?: string | null,
  format?: 'TV' | 'MOVIE' | null,
  page = 1
): Promise<PaginationResult<AnimeMedia>> {
  const cacheKey = `recent_${page}_${genre || 'all'}_${format || 'all'}`;
  const cached = getClientCached<PaginationResult<AnimeMedia>>(cacheKey);
  if (cached) {
    return cached;
  }

  const parts: string[] = [`page=${page}`];
  if (genre && genre !== 'All') parts.push(`genre=${encodeURIComponent(genre)}`);
  if (format) parts.push(`format=${encodeURIComponent(format)}`);
  const url = `/api/recent?${parts.join('&')}`;
  const res = await fetch(url);
  const data = await res.json();
  const result: PaginationResult<AnimeMedia> = {
    results: data.ok && Array.isArray(data.results) ? data.results : [],
    page: data.page || page,
    hasNextPage: Boolean(data.hasNextPage)
  };
  setClientCached(cacheKey, result);
  return result;
}

export async function searchAnime(query: string, page = 1): Promise<PaginationResult<AnimeMedia>> {
  const cleanQ = query.trim().toLowerCase();
  const cacheKey = `search_${cleanQ}_${page}`;
  const cached = getClientCached<PaginationResult<AnimeMedia>>(cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
  const data = await res.json();
  const result: PaginationResult<AnimeMedia> = {
    results: data.ok && Array.isArray(data.results) ? data.results : [],
    page: data.page || page,
    hasNextPage: Boolean(data.hasNextPage)
  };
  setClientCached(cacheKey, result);
  return result;
}

export async function fetchSeriesDetails(alId: number): Promise<SeriesDetailResponse> {
  const cacheKey = `series_${alId}`;
  const cached = getClientCached<SeriesDetailResponse>(cacheKey);
  if (cached && cached.ok) {
    return cached;
  }

  const res = await fetch(`/api/series?al_id=${alId}`);
  const data = await res.json();
  if (data && data.ok) {
    setClientCached(cacheKey, data);
  }
  return data;
}

export async function startCdnExtraction(embedUrl: string): Promise<boolean> {
  const res = await fetch('/api/watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embed_url: embedUrl })
  });
  const data = await res.json();
  return !!data.ok;
}

export async function fetchCdnStatus(): Promise<CdnStatus> {
  const res = await fetch('/api/cdn');
  return await res.json();
}

export interface StartDownloadParams {
  streamUrl: string;
  animeName?: string;
  seasonNum?: number;
  episodeNum?: number;
  quality?: string;
  audioType?: 'SUB' | 'DUB';
  subtitleUrl?: string;
  subtitleLang?: string;
}

export async function startDownload(params: StartDownloadParams): Promise<{ ok: boolean; output_file?: string; target_dir?: string; error?: string }> {
  const res = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stream_url: params.streamUrl,
      anime_name: params.animeName,
      season_num: params.seasonNum,
      episode_num: params.episodeNum,
      quality: params.quality,
      audio_type: params.audioType,
      subtitle_url: params.subtitleUrl,
      subtitle_lang: params.subtitleLang
    })
  });
  return await res.json();
}

export async function fetchDownloadStatus(): Promise<DownloadStatus> {
  const res = await fetch('/api/dl');
  return await res.json();
}

export async function openFolderInExplorer(path: string): Promise<boolean> {
  try {
    const res = await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}
