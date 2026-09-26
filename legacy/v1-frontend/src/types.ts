export interface AnimeTitle {
  romaji?: string;
  english?: string;
  native?: string;
}

export interface AnimeCover {
  medium?: string;
  large?: string;
  extraLarge?: string;
}

export interface StudioNode {
  name: string;
}

export interface StudioData {
  nodes?: StudioNode[];
}

export interface AnimeMedia {
  id: number;
  title?: AnimeTitle;
  episodes?: number;
  season?: string;
  seasonYear?: number;
  format?: string;
  status?: string;
  coverImage?: AnimeCover;
  bannerImage?: string;
  genres?: string[];
  averageScore?: number;
  popularity?: number;
  description?: string;
  studios?: StudioData;
}

export interface EpisodeItem {
  number: number;
  title?: string;
  embed_id?: string;
  sub_url?: string;
  dub_url?: string;
  _globalIdx?: number;
}

export interface SeriesDetailResponse {
  ok: boolean;
  anime?: AnimeMedia;
  episodes?: EpisodeItem[];
  ani_id?: number;
  anikoto_id?: number | null;
  error?: string;
}

export interface SubtitleTrack {
  label: string;
  url: string;
  kind?: string;
}

export interface StreamVariant {
  resolution: string;
  bandwidth: number;
  url: string;
}

export interface CdnStatus {
  status: 'idle' | 'extracting' | 'done' | 'error';
  master?: string | null;
  best?: string | null;
  host?: string | null;
  variants?: StreamVariant[];
  subtitles?: SubtitleTrack[];
  error?: string | null;
}

export interface DownloadStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  message: string;
  progress: number;
  output_file: string;
  error: string;
  bytes_dl: number;
  total_segs: number;
  done_segs: number;
  speed_mbps?: number;
  speed_str?: string;
  mb_downloaded?: number;
}

export interface WatchProgress {
  animeId: number;
  animeTitle: string;
  coverImage: string;
  bannerImage: string;
  epNumber: number;
  epTitle: string;
  seasonName: string;
  embedUrl: string;
  lang: 'SUB' | 'DUB';
  savedSeconds: number;
  durationSeconds: number;
  updatedAt: number;
}

export interface CompletedDownloadItem {
  id: string;
  title: string;
  animeName: string;
  seasonNum: number;
  epNum: number;
  quality: string;
  audio: 'SUB' | 'DUB';
  fileSizeMb: number;
  filePath: string;
  timestamp: number;
}

export interface NavState {
  page: 'home' | 'series' | 'watch' | 'search' | 'adblockers';
  params?: any;
}
