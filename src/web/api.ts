import type { AppCommand, PlayzAnimeApi } from '../shared/api';
import type {
  MangaExtensionInfo,
  AiringItem,
  AppInfo,
  BrowseFilters,
  Chapter,
  ChapterList,
  ChapterPage,
  DownloadJob,
  EpisodeList,
  HomeFeed,
  MangaFeed,
  MangaProviderId,
  Media,
  MediaDetail,
  Paged,
  Profile,
  ProviderHealth,
  ResolvedStream,
  SetupStatus,
} from '../shared/types';
import { browseDirect, homeDirect, mangaHomeDirect, mediaDirect, scheduleDirect } from './anilist';
import { cleanProfile, downloadProfileFile, MAX_FILE_BYTES, parseProfileFile, pickProfileFile, PROFILE_EXT } from './profiles';
import { hasApiBase, rpc } from './rpc';
import * as store from './storage';

/*
 * window.playzanime for the browser. Catalogue, episodes, streams and chapters
 * come from the server; lists, history, settings and profiles live in this
 * browser. Desktop-only parts (downloads, offline files, folders, taskbar
 * buttons) answer with empty values, and the UI shows the Windows app instead.
 */

const done = <T>(value: T) => Promise.resolve(value);
const local = <T>(fn: () => T): Promise<T> => {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
};

const DESKTOP_ONLY = 'Downloads and offline mode are part of the PlayzAnime Windows app.';

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

function setupStatus(): SetupStatus {
  return { setupDone: store.setupDone(), animeDir: '', mangaDir: '', folderIssues: [], guard: 'unknown', online: navigator.onLine };
}

// A .playzanime file opened with the installed web app (file handling) waits here until the page takes it.
let pendingProfile: string | null = null;
const incoming = new Set<() => void>();

interface LaunchParams {
  files?: { getFile(): Promise<File> }[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

function acceptLaunchedFiles() {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(async (params) => {
    const handle = params.files?.[0];
    if (!handle) return;
    try {
      const file = await handle.getFile();
      if (!file.name.toLowerCase().endsWith(`.${PROFILE_EXT}`) || file.size > MAX_FILE_BYTES) return;
      pendingProfile = await file.text();
      incoming.forEach((l) => l());
    } catch {
      /* unreadable file: nothing to import */
    }
  });
}

let cachedInfo: Promise<AppInfo> | null = null;

export const webApi: PlayzAnimeApi = {
  anilist: {
    home: async (refresh?: boolean) => {
      if (hasApiBase) {
        try {
          return await rpc<HomeFeed>('anilist:home', Boolean(refresh));
        } catch {
          /* fallback to direct AniList */
        }
      }
      return homeDirect(store.settings().hideAdult, Boolean(refresh));
    },
    mangaHome: async (refresh?: boolean) => {
      if (hasApiBase) {
        try {
          return await rpc<MangaFeed>('anilist:mangaHome', Boolean(refresh));
        } catch {
          /* fallback to direct AniList */
        }
      }
      return mangaHomeDirect(store.settings().hideAdult, Boolean(refresh));
    },
    browse: async (filters: BrowseFilters) => {
      if (hasApiBase) {
        try {
          return await rpc<Paged<Media>>('anilist:browse', filters ?? {});
        } catch {
          /* fallback to direct AniList */
        }
      }
      return browseDirect(filters ?? {}, store.settings().hideAdult);
    },
    media: async (id: number) => {
      if (hasApiBase) {
        try {
          return await rpc<MediaDetail>('anilist:media', Number(id));
        } catch {
          /* fallback to direct AniList */
        }
      }
      return mediaDirect(Number(id), store.settings().hideAdult);
    },
    schedule: async (fromUnix: number, toUnix: number) => {
      if (hasApiBase) {
        try {
          return await rpc<AiringItem[]>('anilist:schedule', Number(fromUnix), Number(toUnix));
        } catch {
          /* fallback to direct AniList */
        }
      }
      return scheduleDirect(Number(fromUnix), Number(toUnix), store.settings().hideAdult);
    },
  },
  episodes: {
    list: (mediaId: number, refresh?: boolean) => rpc<EpisodeList>('episodes:list', Number(mediaId), Boolean(refresh)),
  },
  stream: {
    resolve: (embedUrl: string, refresh?: boolean) => {
      if (!isHttpUrl(embedUrl)) return Promise.reject(new Error('Invalid embed URL.'));
      return rpc<ResolvedStream>('stream:resolve', embedUrl, Boolean(refresh));
    },
  },
  manga: {
    chapters: (mediaId: number, provider?: MangaProviderId | null, refresh?: boolean) => rpc<ChapterList>('manga:chapters', Number(mediaId), provider ?? null, Boolean(refresh)),
    pages: (chapter: Chapter) => {
      if (!chapter?.id) return Promise.reject(new Error('Unknown chapter.'));
      return rpc<ChapterPage[]>('manga:pages', chapter);
    },
    health: (force?: boolean) => rpc<ProviderHealth[]>('manga:health', Boolean(force)),
    extensions: () => rpc<MangaExtensionInfo[]>('manga:extensions'),
    toggleExtension: (id: string, enabled: boolean) => rpc<{ ok: boolean }>('manga:toggleExtension', id, enabled),
  },

  library: {
    all: () => local(store.library),
    set: (media, status) => local(() => store.setLibrary(media, status)),
    remove: (mediaId) => local(() => store.removeLibrary(Number(mediaId))),
  },
  history: {
    all: () => local(store.history),
    save: (entry) => local(() => store.saveHistory(entry)),
    remove: (mediaId) => local(() => store.removeHistory(Number(mediaId))),
    clear: () => local(store.clearHistory),
    watched: (mediaId) => local(() => store.watched(Number(mediaId))),
    setWatched: (mediaId, episodes, watched) => local(() => store.setWatched(Number(mediaId), (episodes ?? []).map(Number), Boolean(watched))),
  },
  reading: {
    all: () => local(store.reading),
    save: (entry) => local(() => store.saveReading(entry)),
    remove: (mediaId) => local(() => store.removeReading(Number(mediaId))),
    read: (mediaId) => local(() => store.readChapters(Number(mediaId))),
    setRead: (mediaId, chapters, read) => local(() => store.setRead(Number(mediaId), (chapters ?? []).map(String), Boolean(read))),
  },
  settings: {
    // A server running with its video relay off (PLAYZANIME_RELAY=off) can only offer the
    // source's own player, so episodes open there from the start.
    get: () =>
      webApi.app.info().then((info) => {
        const s = store.settings();
        return (info as AppInfo & { streamRelay?: boolean }).streamRelay === false ? { ...s, player: 'embed' as const } : s;
      }),
    set: (patch) => local(() => store.patchSettings(patch ?? {})),
    chooseDir: () => done(null),
  },

  downloads: {
    list: () => done<DownloadJob[]>([]),
    start: () => Promise.reject(new Error(DESKTOP_ONLY)),
    startMany: () => done(0),
    cancel: () => done(undefined),
    retry: () => done(undefined),
    remove: () => done(undefined),
    clearFinished: () => done(undefined),
    open: () => done(false),
    reveal: () => done(false),
    missing: () => done<string[]>([]),
    onUpdate: () => () => {},
  },

  app: {
    info: () => {
      cachedInfo ??= rpc<AppInfo>('app:info').catch(() => {
        cachedInfo = null;
        return { version: '', platform: 'web', electron: '', chrome: '', userData: '', packaged: true };
      });
      return cachedInfo;
    },
    openExternal: (url: string) => {
      if (!isHttpUrl(url)) return Promise.reject(new Error('Only web links can be opened.'));
      window.open(url, '_blank', 'noopener,noreferrer');
      return done(undefined);
    },
    openDir: () => done(undefined),
    // The server's caches are shared by everyone; the page's own caches are cleared by the caller.
    clearCache: () => done(undefined),
    setPlayer: () => done(undefined),
    setAppIcon: () => done({ ok: true }),
    onCommand: (_listener: (command: AppCommand) => void) => () => {},
    online: () => done(navigator.onLine),
  },

  setup: {
    isDone: () => local(store.setupDone),
    status: () => local(setupStatus),
    allowFolders: () => local(() => ({ approved: false, status: setupStatus() })),
    complete: () => local(store.markSetupDone),
  },

  profile: {
    get: () => local(store.profile),
    set: (p: Profile | null) =>
      local(() => {
        store.setProfile(p ? cleanProfile(p) : null);
        return store.profile();
      }),
    export: () => local(() => downloadProfileFile(store.exportProfile())),
    pick: () => pickProfileFile(),
    preview: (text: string) => local(() => parseProfileFile(String(text ?? ''), store.profile()?.id ?? null)),
    import: (text: string) => local(() => store.addImported(parseProfileFile(String(text ?? ''), store.profile()?.id ?? null))),
    imported: () => local(store.importedProfiles),
    removeImported: (profileId: string) => local(() => store.removeImported(String(profileId))),
    takePending: () =>
      local(() => {
        const text = pendingProfile;
        pendingProfile = null;
        return text;
      }),
    onIncoming: (listener: () => void) => {
      incoming.add(listener);
      return () => incoming.delete(listener);
    },
  },

  offline: {
    items: () => done([]),
    pageCount: () => done(0),
  },
};

/** Installs the API and paints in the viewer's accent before React renders anything. */
export function installWebApi() {
  window.playzanime = webApi;
  document.documentElement.dataset.accent = store.settings().accent;
  acceptLaunchedFiles();
}
