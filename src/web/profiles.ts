import type { HistoryEntry, LibraryEntry, MediaSnapshot, Profile, ProfileExport, ReadingEntry } from '../shared/types';

/*
 * Profiles are plain JSON files ending in .playzanime. They never leave the
 * browser on their own: people share them however they like and whoever receives
 * one drops it onto the app. The checks are the desktop app's, field by field, so
 * a file made by either version imports into the other.
 */

export const PROFILE_EXT = 'playzanime';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_AVATAR_CHARS = 1_500_000; // ~1 MB image as a data URL
const MAX_ITEMS = 2000;

/** crypto.randomUUID only exists on https and localhost; a LAN address over http has getRandomValues only. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function snapshot(v: unknown): MediaSnapshot | null {
  const m = v as Partial<MediaSnapshot> | null;
  const id = num(m?.id);
  const title = str(m?.title);
  if (!m || !id || !title || (m.type !== 'ANIME' && m.type !== 'MANGA')) return null;
  const https = (u: unknown) => {
    const s = str(u, 1000);
    return s && s.startsWith('https://') ? s : null;
  };
  return {
    id,
    type: m.type,
    title,
    romaji: str(m.romaji),
    native: str(m.native),
    cover: https(m.cover) ?? '',
    banner: https(m.banner),
    color: str(m.color, 16),
    format: str(m.format, 16) as MediaSnapshot['format'],
    episodes: num(m.episodes),
    chapters: num(m.chapters),
    year: num(m.year),
    status: str(m.status, 24) as MediaSnapshot['status'],
  };
}

function avatar(v: unknown): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s) && s.length <= MAX_AVATAR_CHARS ? s : null;
}

export function cleanProfile(v: unknown): Profile {
  const p = (v ?? {}) as Partial<Profile>;
  return {
    id: str(p.id, 64) ?? uuid(),
    name: str(p.name, 40) ?? 'PlayzAnime viewer',
    avatar: avatar(p.avatar),
    tagline: str(p.tagline, 120),
    favorites: (Array.isArray(p.favorites) ? p.favorites : [])
      .map(snapshot)
      .filter((m): m is MediaSnapshot => m !== null)
      .slice(0, 24),
    createdAt: num(p.createdAt) ?? Date.now(),
  };
}

/** Checks a .playzanime file field by field; anything unexpected is dropped, never trusted. */
export function parseProfileFile(text: string, ownId: string | null): ProfileExport {
  if (text.length > MAX_FILE_BYTES) throw new Error('That file is too large to be a PlayzAnime profile.');
  let raw: Partial<ProfileExport>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a PlayzAnime profile.');
  }
  if (raw?.format !== 'playzanime-profile') throw new Error('That file isn’t a PlayzAnime profile.');
  if (raw.version !== 1) throw new Error('That profile was made by a newer PlayzAnime. Update to import it.');
  if (raw.profile?.id && raw.profile.id === ownId) throw new Error('That’s your own profile.');

  const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] =>
    (Array.isArray(v) ? v : [])
      .slice(0, MAX_ITEMS)
      .map((x) => map((x ?? {}) as Record<string, unknown>))
      .filter((x): x is T => x !== null);

  const library = list<LibraryEntry>(raw.library, (e) => {
    const media = snapshot(e.media);
    const status = e.status as LibraryEntry['status'];
    if (!media || !['watching', 'planning', 'completed', 'paused', 'dropped'].includes(status)) return null;
    return { media, status, addedAt: num(e.addedAt) ?? 0, updatedAt: num(e.updatedAt) ?? 0 };
  });
  const history = list<HistoryEntry>(raw.history, (e) => {
    const media = snapshot(e.media);
    const episode = num(e.episode);
    if (!media || episode === null) return null;
    return {
      media,
      episode,
      episodeTitle: str(e.episodeTitle),
      thumbnail: null,
      position: num(e.position) ?? 0,
      duration: num(e.duration) ?? 0,
      audio: e.audio === 'dub' ? 'dub' : 'sub',
      updatedAt: num(e.updatedAt) ?? 0,
    };
  });
  const reading = list<ReadingEntry>(raw.reading, (e) => {
    const media = snapshot(e.media);
    if (!media) return null;
    return {
      media,
      chapterId: str(e.chapterId, 200) ?? '',
      chapterNumber: str(e.chapterNumber, 16),
      chapterTitle: str(e.chapterTitle),
      page: num(e.page) ?? 0,
      pages: num(e.pages) ?? 0,
      updatedAt: num(e.updatedAt) ?? 0,
    };
  });

  return { format: 'playzanime-profile', version: 1, exportedAt: num(raw.exportedAt) ?? Date.now(), profile: cleanProfile(raw.profile), library, history, reading };
}

/** Saves the profile as a .playzanime file through the browser's download. Returns the file name. */
export function downloadProfileFile(data: ProfileExport): string {
  const safeName = data.profile.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'profile';
  const name = `${safeName}.${PROFILE_EXT}`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** Opens the browser's file picker and returns the chosen file's text, or null if cancelled. */
export function pickProfileFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${PROFILE_EXT},.json,application/json`;
    let settled = false;
    const finish = (v: string | null, err?: Error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      if (err) reject(err);
      else resolve(v);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      if (file.size > MAX_FILE_BYTES) return finish(null, new Error('That file is too large to be a PlayzAnime profile.'));
      file.text().then(
        (t) => finish(t),
        () => finish(null, new Error('Couldn’t read that file.')),
      );
    });
    input.addEventListener('cancel', () => finish(null));
    // Browsers without the cancel event: the window gets focus back when the picker closes.
    const onFocus = () => window.setTimeout(() => !input.files?.length && finish(null), 800);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}
