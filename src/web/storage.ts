import type { HistoryEntry, ImportedProfile, LibraryEntry, ListStatus, MediaSnapshot, Profile, ProfileExport, ReadingEntry, Settings } from '../shared/types';

/*
 * Everything the desktop keeps in its data file, kept in this browser instead.
 * Each part has its own localStorage key, so a busy one (watch history, written
 * every few seconds while playing) never rewrites the others. Reads come from an
 * in-memory copy; when storage is unavailable (some private windows) the app still
 * works, it just forgets on reload.
 */

const PREFIX = 'playzanime:';
const MAX_HISTORY = 80;

export function defaultSettings(): Settings {
  return {
    accent: 'shu',
    titleLanguage: 'english',
    showNativeTitles: true,
    player: 'direct',
    preferDub: false,
    autoplayNext: true,
    autoSkipIntro: false,
    quality: 'best',
    volume: 1,
    subtitleLanguage: 'English',
    // Downloads are a desktop feature; the web version has no folders.
    animeDir: '',
    mangaDir: '',
    readerMode: 'vertical',
    readerDirection: 'rtl',
    readerFit: 'width',
    mangaProvider: 'auto',
    adblock: true,
    hideAdult: true,
    notifyDownloads: false,
    dataSaver: false,
  };
}

interface Data {
  settings: Settings;
  library: Record<string, LibraryEntry>;
  history: Record<string, HistoryEntry>;
  watched: Record<string, number[]>;
  reading: Record<string, ReadingEntry>;
  read: Record<string, string[]>;
  setup: { done: boolean };
  profile: Profile | null;
  imported: ImportedProfile[];
}

type Key = keyof Data;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load<K extends Key>(key: K, fallback: Data[K]): Data[K] {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Data[K];
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSettings(): Settings {
  const base = defaultSettings();
  const raw = load('settings', base) as Partial<Settings>;
  const clean = Object.fromEntries(Object.entries(raw ?? {}).filter(([k]) => k in base));
  return { ...base, ...clean };
}

const data: Data = {
  settings: loadSettings(),
  library: load('library', {}),
  history: load('history', {}),
  watched: load('watched', {}),
  reading: load('reading', {}),
  read: load('read', {}),
  setup: load('setup', { done: false }),
  profile: load('profile', null),
  imported: load('imported', []),
};

export class StorageFullError extends Error {}

function save(key: Key) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify(data[key]));
  } catch (err) {
    if (err instanceof DOMException && /quota/i.test(err.name + err.message)) {
      throw new StorageFullError('This browser’s storage for PlayzAnime is full. Remove a shared profile or clear history, then try again.');
    }
  }
}

// Another tab changed something: take its copy, so neither tab overwrites the other's work.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length) as Key;
    if (!(key in data)) return;
    if (key === 'settings') data.settings = loadSettings();
    else (data as unknown as Record<Key, unknown>)[key] = load(key, data[key]);
  });
}

// ── Settings ──

export function settings(): Settings {
  return { ...data.settings };
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const allowed = Object.keys(defaultSettings());
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)));
  data.settings = { ...data.settings, ...clean };
  save('settings');
  return settings();
}

// ── Setup & profile ──

export const setupDone = () => data.setup.done;

export function markSetupDone() {
  data.setup = { done: true };
  save('setup');
}

export const profile = () => data.profile;

export function setProfile(p: Profile | null) {
  data.profile = p;
  save('profile');
}

/** Everything a friend needs to see what we watch and read. Settings stay private. */
export function exportProfile(): ProfileExport {
  const p = data.profile ?? { id: 'anonymous', name: 'PlayzAnime viewer', avatar: null, tagline: null, favorites: [], createdAt: Date.now() };
  return { format: 'playzanime-profile', version: 1, exportedAt: Date.now(), profile: p, library: library(), history: history(), reading: reading() };
}

export function importedProfiles(): ImportedProfile[] {
  return [...data.imported].sort((a, b) => b.importedAt - a.importedAt);
}

/** Re-importing the same person replaces their earlier copy instead of duplicating it. */
export function addImported(p: ProfileExport): ImportedProfile {
  const entry: ImportedProfile = { ...p, importedAt: Date.now() };
  const before = data.imported;
  data.imported = [entry, ...before.filter((x) => x.profile.id !== p.profile.id)];
  try {
    save('imported');
  } catch (err) {
    data.imported = before;
    throw err;
  }
  return entry;
}

export function removeImported(profileId: string) {
  data.imported = data.imported.filter((x) => x.profile.id !== profileId);
  save('imported');
}

// ── Library ──

export function library(): LibraryEntry[] {
  return Object.values(data.library).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function setLibrary(media: MediaSnapshot, status: ListStatus): LibraryEntry[] {
  const key = String(media.id);
  const now = Date.now();
  const prev = data.library[key];
  data.library[key] = { media, status, addedAt: prev?.addedAt ?? now, updatedAt: now };
  save('library');
  return library();
}

export function removeLibrary(mediaId: number): LibraryEntry[] {
  delete data.library[String(mediaId)];
  save('library');
  return library();
}

/** Opening something from the planning list moves it to watching/reading. */
function promoteFromPlanning(mediaId: number) {
  const entry = data.library[String(mediaId)];
  if (entry && entry.status === 'planning') {
    entry.status = 'watching';
    entry.updatedAt = Date.now();
    save('library');
  }
}

// ── Watch history ──

export function history(): HistoryEntry[] {
  return Object.values(data.history).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveHistory(entry: HistoryEntry) {
  data.history[String(entry.media.id)] = entry;
  for (const old of history().slice(MAX_HISTORY)) delete data.history[String(old.media.id)];
  save('history');
  promoteFromPlanning(entry.media.id);
}

export function removeHistory(mediaId: number): HistoryEntry[] {
  delete data.history[String(mediaId)];
  save('history');
  return history();
}

export function clearHistory() {
  data.history = {};
  data.watched = {};
  data.reading = {};
  data.read = {};
  for (const key of ['history', 'watched', 'reading', 'read'] as const) save(key);
}

export function watched(mediaId: number): number[] {
  return [...(data.watched[String(mediaId)] ?? [])];
}

export function setWatched(mediaId: number, episodes: number[], value: boolean): number[] {
  const key = String(mediaId);
  const set = new Set(data.watched[key] ?? []);
  for (const ep of episodes) {
    if (value) set.add(ep);
    else set.delete(ep);
  }
  data.watched[key] = [...set].sort((a, b) => a - b);
  save('watched');
  return watched(mediaId);
}

// ── Reading history ──

export function reading(): ReadingEntry[] {
  return Object.values(data.reading).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveReading(entry: ReadingEntry) {
  data.reading[String(entry.media.id)] = entry;
  for (const old of reading().slice(MAX_HISTORY)) delete data.reading[String(old.media.id)];
  save('reading');
  promoteFromPlanning(entry.media.id);
}

export function removeReading(mediaId: number): ReadingEntry[] {
  delete data.reading[String(mediaId)];
  save('reading');
  return reading();
}

export function readChapters(mediaId: number): string[] {
  return [...(data.read[String(mediaId)] ?? [])];
}

export function setRead(mediaId: number, chapters: string[], value: boolean): string[] {
  const key = String(mediaId);
  const set = new Set(data.read[key] ?? []);
  for (const c of chapters) {
    if (value) set.add(c);
    else set.delete(c);
  }
  data.read[key] = [...set];
  save('read');
  return readChapters(mediaId);
}
