import './styles/theme.css';
import type {
  AnimeMedia,
  EpisodeItem,
  SeriesDetailResponse,
  NavState,
  StreamVariant,
  SubtitleTrack,
  WatchProgress,
  CompletedDownloadItem
} from './types';
import {
  fetchTrendingAnime,
  searchAnime,
  fetchSeriesDetails,
  startCdnExtraction,
  fetchCdnStatus,
  startDownload,
  fetchDownloadStatus,
  openFolderInExplorer
} from './api';

// ─────────────────────────────────────────────────────────────────────────────
// STATE & NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
interface ApplicationState {
  currentPage: 'home' | 'series' | 'watch' | 'search' | 'adblockers';
  currentFormatFilter: 'ALL' | 'TV' | 'MOVIE';
  currentPageNum: number;
  hasNextPage: boolean;
  currentParams: Record<string, unknown>;
  activeGenre: string | null;
  activeMasterUrl: string | null;
  activeVariants: StreamVariant[];
  activeSubtitles: SubtitleTrack[];
  selectedSubtitleUrl: string | null;
  selectedSubtitleLang: string | null;
  cdnInterval: number | null;
  dlInterval: number | null;
  watchTrackerInterval: number | null;
  isTheaterMode: boolean;
  currentSeriesEpisodes: EpisodeItem[];
  currentEpIdx: number;
  currentEpNumber: number;
  currentEpTitle: string;
  currentAnimeId: number;
  currentAnimeTitle: string;
  currentAnimeCover: string;
  currentAnimeBanner: string;
  currentSeasonNum: number;
  currentAudioType: 'SUB' | 'DUB';
  downloadAudioType: 'SUB' | 'DUB';
  currentPlaybackSeconds: number;
  currentDurationSeconds: number;
  currentEmbedProvider: 'megaplay';
  currentEmbedUrl: string;
  isMovie: boolean;
}

const AppState: ApplicationState = {
  currentPage: 'home',
  currentFormatFilter: 'ALL',
  currentPageNum: 1,
  hasNextPage: false,
  currentParams: {},
  activeGenre: null,
  activeMasterUrl: null,
  activeVariants: [],
  activeSubtitles: [],
  selectedSubtitleUrl: null,
  selectedSubtitleLang: null,
  cdnInterval: null,
  dlInterval: null,
  watchTrackerInterval: null,
  isTheaterMode: false,
  currentSeriesEpisodes: [],
  currentEpIdx: -1,
  currentEpNumber: 1,
  currentEpTitle: '',
  currentAnimeId: 0,
  currentAnimeTitle: '',
  currentAnimeCover: '',
  currentAnimeBanner: '',
  currentSeasonNum: 1,
  currentAudioType: 'SUB',
  downloadAudioType: 'SUB',
  currentPlaybackSeconds: 0,
  currentDurationSeconds: 1440,
  currentEmbedProvider: 'megaplay',
  currentEmbedUrl: '',
  isMovie: false
};

export function startLoadingBar() {
  const bar = document.getElementById('top-loader-bar');
  if (!bar) return;
  bar.classList.remove('done');
  bar.style.width = '0%';
  bar.classList.add('loading');
  requestAnimationFrame(() => {
    bar.style.width = '70%';
  });
}

export function finishLoadingBar() {
  const bar = document.getElementById('top-loader-bar');
  if (!bar) return;
  bar.style.width = '100%';
  bar.classList.add('done');
  setTimeout(() => {
    bar.classList.remove('loading', 'done');
    bar.style.width = '0%';
  }, 400);
}

const navStack: NavState[] = [];

export function navigateTo(page: 'home' | 'series' | 'watch' | 'search' | 'adblockers', params: Record<string, unknown> = {}, addToHistory = true) {
  stopAllPolls();

  if (addToHistory && AppState.currentPage) {
    navStack.push({ page: AppState.currentPage, params: AppState.currentParams });
  }

  AppState.currentPage = page;
  AppState.currentParams = params;
  updateBackBtn();
  updateNavActiveLinks();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (page === 'home') {
    renderHomePage();
  } else if (page === 'series') {
    renderSeriesPage(params as unknown as SeriesDetailResponse);
  } else if (page === 'watch') {
    renderWatchPage(params as unknown as WatchPageParams);
  } else if (page === 'search') {
    renderSearchPage(params.query as string, (params.page as number) || 1);
  } else if (page === 'adblockers') {
    renderAdBlockersPage();
  }
}

export function goBack() {
  stopAllPolls();
  if (navStack.length > 0) {
    const prev = navStack.pop()!;
    navigateTo(prev.page, prev.params, false);
  } else {
    navigateTo('home', {}, false);
  }
}

function updateBackBtn() {
  const btn = document.getElementById('nav-back-btn');
  if (!btn) return;
  btn.classList.toggle('show', navStack.length > 0);
}

function updateNavActiveLinks() {
  const homeLink = document.getElementById('nav-home-link');
  const seriesLink = document.getElementById('nav-series-link');
  const moviesLink = document.getElementById('nav-movies-link');
  const adblockersLink = document.getElementById('nav-adblockers-link');

  if (homeLink) homeLink.classList.toggle('active', AppState.currentPage === 'home' && AppState.currentFormatFilter === 'ALL');
  if (seriesLink) seriesLink.classList.toggle('active', AppState.currentPage === 'home' && AppState.currentFormatFilter === 'TV');
  if (moviesLink) moviesLink.classList.toggle('active', AppState.currentPage === 'home' && AppState.currentFormatFilter === 'MOVIE');
  if (adblockersLink) adblockersLink.classList.toggle('active', AppState.currentPage === 'adblockers');
}

function stopAllPolls() {
  if (AppState.cdnInterval) {
    window.clearInterval(AppState.cdnInterval);
    AppState.cdnInterval = null;
  }
  if (AppState.dlInterval) {
    window.clearInterval(AppState.dlInterval);
    AppState.dlInterval = null;
  }
  if (AppState.watchTrackerInterval) {
    window.clearInterval(AppState.watchTrackerInterval);
    AppState.watchTrackerInterval = null;
    flushWatchProgress();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STRING & FORMATTING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function esc(str: unknown): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanDesc(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatEpisodeHeader(epNumber: number, title?: string): string {
  if (AppState.isMovie) {
    if (title && title.trim().toLowerCase() !== 'full' && !title.toLowerCase().startsWith('episode')) {
      return title.trim();
    }
    return 'Full Movie';
  }
  const epNumStr = `Episode ${epNumber}`;
  if (!title || title.trim().toLowerCase() === 'full') {
    return epNumStr;
  }
  const cleanT = title.trim();
  if (cleanT.toLowerCase() === epNumStr.toLowerCase()) {
    return cleanT;
  }
  if (cleanT.toLowerCase().startsWith('episode')) {
    return cleanT;
  }
  return `${epNumStr} — ${cleanT}`;
}

function parseQualityBadge(res: string, bandwidth: number): { badge: string; tag: string } {
  const m = res.match(/(\d+)x(\d+)/);
  const height = m ? parseInt(m[2], 10) : 0;

  if (height >= 1080 || res.includes('1080')) return { badge: '1080p FHD', tag: '1080p' };
  if (height >= 720 || res.includes('720')) return { badge: '720p HD', tag: '720p' };
  if (height >= 480 || res.includes('480')) return { badge: '480p SD', tag: '480p' };
  if (height >= 360 || res.includes('360')) return { badge: '360p SD', tag: '360p' };
  if (height > 0) return { badge: `${height}p`, tag: `${height}p` };

  const kbps = Math.round(bandwidth / 1000);
  if (kbps >= 3500) return { badge: '1080p FHD', tag: '1080p' };
  if (kbps >= 1500) return { badge: '720p HD', tag: '720p' };
  if (kbps >= 800) return { badge: '480p SD', tag: '480p' };
  return { badge: '360p SD', tag: '360p' };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
let toastTimer: number | null = null;
function toast(msg: string) {
  const el = document.getElementById('toast-notification');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('active');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove('active');
  }, 3200);
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME & APPEARANCE CUSTOMIZER (SETTINGS)
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_THEME_KEY = 'playzae_theme_color';

function initThemeColor() {
  const saved = localStorage.getItem(STORAGE_THEME_KEY) || '#10b981';
  applyThemeColor(saved);
}

function applyThemeColor(color: string) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--primary', color);
  document.documentElement.style.setProperty('--primary-light', color);
  document.documentElement.style.setProperty('--border-glow', `${color}55`);
  document.documentElement.style.setProperty('--accent-glow', `${color}40`);
  document.documentElement.style.setProperty('--brand-gradient', `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`);
  localStorage.setItem(STORAGE_THEME_KEY, color);

  document.querySelectorAll('.theme-color-btn').forEach(btn => {
    const c = btn.getAttribute('data-color');
    btn.classList.toggle('active', c === color);
  });
}

function setupSettingsModal() {
  const openBtn = document.getElementById('nav-settings-btn');
  const modal = document.getElementById('settings-modal-box');
  const closeBtn = document.getElementById('settings-close-btn');
  const openAdblockersBtn = document.getElementById('settings-open-adblockers-btn');

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  if (openAdblockersBtn && modal) {
    openAdblockersBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      navigateTo('adblockers');
    });
  }

  document.querySelectorAll('.theme-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color');
      if (color) {
        applyThemeColor(color);
        toast(`Accent color set to ${color}`);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCH PROGRESS & CACHING (CONTINUE WATCHING)
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_WATCH_KEY = 'anistream_watch_history';
const STORAGE_DOWNLOADS_KEY = 'anistream_downloads_history';

function getWatchHistory(): WatchProgress[] {
  try {
    const raw = localStorage.getItem(STORAGE_WATCH_KEY);
    const list: WatchProgress[] = raw ? JSON.parse(raw) : [];
    return list.map(item => {
      const isMovieItem = item.seasonName === 'Movie' ||
        item.epTitle === 'Full Movie' ||
        (item.animeTitle && item.animeTitle.toLowerCase().includes('silent voice'));
      if (isMovieItem) {
        return {
          ...item,
          epNumber: 1,
          epTitle: 'Full Movie',
          seasonName: 'Movie'
        };
      }
      return item;
    });
  } catch {
    return [];
  }
}

function saveWatchProgress(item: WatchProgress) {
  try {
    const list = getWatchHistory().filter(x => x.animeId !== item.animeId);
    list.unshift(item);
    localStorage.setItem(STORAGE_WATCH_KEY, JSON.stringify(list.slice(0, 12)));
  } catch {}
}

function flushWatchProgress() {
  if (AppState.currentAnimeId && AppState.currentPlaybackSeconds > 5) {
    const isMovieItem = AppState.isMovie;
    saveWatchProgress({
      animeId: AppState.currentAnimeId,
      animeTitle: AppState.currentAnimeTitle,
      coverImage: AppState.currentAnimeCover,
      bannerImage: AppState.currentAnimeBanner,
      epNumber: isMovieItem ? 1 : AppState.currentEpNumber,
      epTitle: isMovieItem ? 'Full Movie' : AppState.currentEpTitle,
      seasonName: isMovieItem ? 'Movie' : `Season ${AppState.currentSeasonNum}`,
      embedUrl: AppState.currentEmbedUrl || '',
      lang: AppState.currentAudioType,
      savedSeconds: AppState.currentPlaybackSeconds,
      durationSeconds: AppState.currentDurationSeconds,
      updatedAt: Date.now()
    });
  }
}

function removeWatchProgress(animeId: number) {
  try {
    const list = getWatchHistory().filter(x => x.animeId !== animeId);
    localStorage.setItem(STORAGE_WATCH_KEY, JSON.stringify(list));
  } catch {}
}

function getProgressForAnime(animeId: number): WatchProgress | null {
  const list = getWatchHistory();
  return list.find(x => x.animeId === animeId) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS & DOWNLOAD HISTORY MANAGER
// ─────────────────────────────────────────────────────────────────────────────
function getDownloadsHistory(): CompletedDownloadItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_DOWNLOADS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addCompletedDownload(item: CompletedDownloadItem) {
  try {
    const list = getDownloadsHistory().filter(x => x.id !== item.id);
    list.unshift(item);
    localStorage.setItem(STORAGE_DOWNLOADS_KEY, JSON.stringify(list.slice(0, 20)));
    updateNotificationUI();
  } catch {}
}

function clearDownloadsHistory() {
  try {
    localStorage.removeItem(STORAGE_DOWNLOADS_KEY);
    updateNotificationUI();
  } catch {}
}

function updateNotificationUI() {
  const badge = document.getElementById('nav-notif-count');
  const container = document.getElementById('notif-list-container');
  const items = getDownloadsHistory();

  if (badge) {
    if (items.length > 0) {
      badge.textContent = String(items.length);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  if (container) {
    if (!items.length) {
      container.innerHTML = `<div class="notif-empty">No downloads yet. Completed episodes appear here.</div>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="notif-item">
        <div class="notif-title">${esc(item.animeName)} — ${esc(item.title || 'Episode ' + item.epNum)}</div>
        <div class="notif-meta">
          <span>${item.fileSizeMb} MB · ${item.audio} · Saved to Videos</span>
          <span>${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <button class="notif-btn-open" data-path="${esc(item.filePath)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Open in Videos
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.notif-btn-open').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = btn.getAttribute('data-path') || '';
        if (p) openFolderInExplorer(p);
      });
    });
  }
}

function setupNotifications() {
  const btn = document.getElementById('nav-notif-btn');
  const drop = document.getElementById('nav-notif-dropdown');
  const clearBtn = document.getElementById('notif-clear-btn');
  const wrap = document.getElementById('nav-notif-wrap');

  if (!btn || !drop) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShown = drop.style.display === 'block';
    drop.style.display = isShown ? 'none' : 'block';
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearDownloadsHistory();
    });
  }

  document.addEventListener('click', (e) => {
    if (wrap && !wrap.contains(e.target as Node)) {
      drop.style.display = 'none';
    }
  });

  updateNotificationUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH ACRONYM & ALIAS RESOLVER (JJK, AOT, DBZ, OP, ETC.)
// ─────────────────────────────────────────────────────────────────────────────
const SEARCH_ALIASES: Record<string, string> = {
  'jjk': 'Jujutsu Kaisen',
  'aot': 'Attack on Titan',
  'snk': 'Shingeki no Kyojin',
  'mha': 'My Hero Academia',
  'bnha': 'Boku no Hero Academia',
  'db': 'Dragon Ball',
  'dbz': 'Dragon Ball Z',
  'dbs': 'Dragon Ball Super',
  'ds': 'Demon Slayer',
  'kny': 'Kimetsu no Yaiba',
  'op': 'One Piece',
  'csm': 'Chainsaw Man',
  'fma': 'Fullmetal Alchemist',
  'fmab': 'Fullmetal Alchemist: Brotherhood',
  'sao': 'Sword Art Online',
  'nge': 'Neon Genesis Evangelion',
  'eva': 'Neon Genesis Evangelion',
  'opm': 'One Punch Man',
  'hxh': 'Hunter x Hunter',
  'sl': 'Solo Leveling',
  'tg': 'Tokyo Ghoul',
  'bc': 'Black Clover',
  'bleach': 'Bleach',
  'naruto': 'Naruto',
  'shippuden': 'Naruto Shippuden',
  'boruto': 'Boruto',
  'death note': 'Death Note',
  'dn': 'Death Note',
  'cg': 'Code Geass',
  'fate': 'Fate/stay night',
  'vinland': 'Vinland Saga',
  'slime': 'That Time I Got Reincarnated as a Slime',
  'mob': 'Mob Psycho 100',
  'mp100': 'Mob Psycho 100',
  'dr stone': 'Dr. Stone',
  'stone': 'Dr. Stone',
  'blue lock': 'Blue Lock',
  'spy x family': 'Spy x Family',
  'sxf': 'Spy x Family',
  'haikyuu': 'Haikyuu!!',
  'kaiju': 'Kaiju No. 8',
  'frieren': 'Frieren: Beyond Journey\'s End',
  'dandadan': 'Dandadan'
};

function resolveSearchQuery(q: string): string {
  const norm = q.trim().toLowerCase();
  return SEARCH_ALIASES[norm] || q.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME PAGE & SPOTLIGHT SHOWCASE (RANDOMIZED ON EACH LOAD)
// ─────────────────────────────────────────────────────────────────────────────
const GENRES = [
  'All', 'Action', 'Adventure', 'Fantasy', 'Sci-Fi', 'Romance',
  'Comedy', 'Supernatural', 'Mystery', 'Sports', 'Drama'
];

let heroTrendingCache: AnimeMedia[] = [];

function renderCardSkeletons(count = 12): string {
  return Array.from({ length: count })
    .map(() => `
      <div class="skeleton-card">
        <div class="skeleton-box" style="aspect-ratio:2/3;border-radius:10px"></div>
        <div class="skeleton-box" style="height:14px;width:75%;margin-top:10px;border-radius:4px"></div>
        <div class="skeleton-box" style="height:10px;width:45%;margin-top:6px;border-radius:4px"></div>
      </div>
    `).join('');
}

function renderAnimeCards(list: AnimeMedia[]): string {
  if (!list.length) {
    return `<div class="empty-state">No matching titles found. Try searching or adjusting filters.</div>`;
  }

  return list.map(item => {
    const titles = item.title || {};
    const title = titles.english || titles.romaji || 'Untitled';
    const cover = (item.coverImage || {}).extraLarge || (item.coverImage || {}).large || '';
    const score = item.averageScore ? (item.averageScore / 10).toFixed(1) : null;
    const matchPct = item.averageScore ? `${item.averageScore}%` : '85%';
    const format = item.format || 'TV';
    const isMovie = format === 'MOVIE';
    const year = item.seasonYear || '';

    return `
      <div class="anime-card" data-al-id="${item.id}" data-al-title="${esc(title)}">
        <div class="card-poster-wrap">
          <div class="card-badge-tag ${isMovie ? 'movie' : 'tv'}">${isMovie ? 'MOVIE' : 'TV'}</div>
          ${score ? `
          <div class="card-badge-score">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            ${score}
          </div>` : ''}
          <img class="card-poster" src="${cover}" alt="${esc(title)}" loading="lazy">
        </div>
        <div class="card-content">
          <div>
            <div class="card-title">${esc(title)}</div>
            <div class="card-match-meta">
              ${matchPct} match <span>· ${year || (isMovie ? 'Film' : 'Series')}</span>
            </div>
          </div>
          <div class="card-footer">
            <span class="card-meta">${item.episodes ? `${item.episodes} Ep` : (isMovie ? 'Movie' : 'Releasing')}</span>
            <span class="card-format-tag">${format}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderPagination(currentPage: number, hasNextPage: boolean): string {
  const pages: (number | string)[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = hasNextPage ? currentPage + 2 : currentPage;

  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('...');
  }

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (hasNextPage) {
    pages.push('...');
  }

  return `
    <button class="page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>
      ‹ Prev
    </button>
    ${pages.map(p => {
      if (typeof p === 'string') {
        return `<span class="page-ellipsis">...</span>`;
      }
      return `
        <button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">
          ${p}
        </button>
      `;
    }).join('')}
    <button class="page-btn" data-page="${currentPage + 1}" ${!hasNextPage ? 'disabled' : ''}>
      Next ›
    </button>
  `;
}

function bindPaginationClicks(container: HTMLElement, onSelect: (page: number) => void) {
  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pageAttr = btn.getAttribute('data-page');
      if (pageAttr && !(btn as HTMLButtonElement).disabled) {
        const p = parseInt(pageAttr, 10);
        if (p > 0) onSelect(p);
      }
    });
  });
}

function renderSeriesSkeleton() {
  const view = document.getElementById('page-view');
  if (!view) return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  view.innerHTML = `
    <div class="series-hero-wrap">
      <div class="skeleton-box" style="width:100%;height:100%;opacity:0.4"></div>
    </div>
    <div class="series-main">
      <div class="series-header-grid">
        <div class="series-poster-box">
          <div class="skeleton-box" style="width:100%;height:100%;border-radius:var(--radius-sm)"></div>
        </div>
        <div class="series-info-box">
          <div class="skeleton-box" style="width:55%;height:40px;border-radius:6px;margin-bottom:14px"></div>
          <div class="skeleton-box" style="width:35%;height:20px;border-radius:4px;margin-bottom:18px"></div>
          <div class="skeleton-box" style="width:90%;height:60px;border-radius:6px;margin-bottom:24px"></div>
          <div style="display:flex;gap:12px">
            <div class="skeleton-box" style="width:150px;height:44px;border-radius:8px"></div>
            <div class="skeleton-box" style="width:150px;height:44px;border-radius:8px"></div>
          </div>
        </div>
      </div>
      <div style="margin-top:3.5rem">
        <div class="skeleton-box" style="width:220px;height:26px;border-radius:4px;margin-bottom:1.5rem"></div>
        <div class="grid">${renderCardSkeletons(12)}</div>
      </div>
    </div>
  `;
}

function bindCardClicks() {
  document.querySelectorAll('.anime-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = Number(card.getAttribute('data-al-id'));
      if (id) loadSeriesById(id, card as HTMLElement);
    });
  });
}

function renderHomePage() {
  const view = document.getElementById('page-view');
  if (!view) return;

  const history = getWatchHistory();
  const formatTag = AppState.currentFormatFilter === 'MOVIE' ? 'Movies' : (AppState.currentFormatFilter === 'TV' ? 'Anime Series' : 'Trending Now');

  view.innerHTML = `
    <!-- Featured Spotlight Hero Showcase -->
    <div class="hero-wrapper" id="hero-wrapper">
      <div id="hero-spotlight-box">
        <div class="hero-featured-card" style="min-height:380px">
          <div class="skeleton-box" style="width:100%;height:100%"></div>
        </div>
      </div>
    </div>

    <!-- Continue Watching Section (if history exists) -->
    ${history.length > 0 ? `
    <div class="continue-watching-section" id="continue-watching-section">
      <div class="section-title">Continue Watching</div>
      <div class="continue-grid">
        ${history.map(item => {
          const pct = Math.min(100, Math.round((item.savedSeconds / (item.durationSeconds || 1440)) * 100));
          const isMovieItem = item.seasonName === 'Movie' || item.epTitle === 'Full Movie';
          const epDisplay = isMovieItem ? `Movie (${item.lang})` : `Episode ${item.epNumber} (${item.lang})`;
          return `
            <div class="continue-card" data-resume-id="${item.animeId}">
              <div class="continue-thumb-box">
                <img src="${item.coverImage}" alt="${esc(item.animeTitle)}">
              </div>
              <div class="continue-info">
                <div class="continue-title">${esc(item.animeTitle)}</div>
                <div class="continue-ep">${epDisplay}</div>
                <div class="continue-time">${formatTime(item.savedSeconds)} / ${formatTime(item.durationSeconds || 1440)}</div>
                <div class="continue-bar-track">
                  <div class="continue-bar-fill" style="width:${pct}%"></div>
                </div>
              </div>
              <button class="continue-dismiss-btn" data-dismiss-id="${item.animeId}" title="Remove from Continue Watching">✕</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Top 10 Ranked Row with Giant Hollow Numbers -->
    <div class="section" id="top-10-section" style="padding-bottom:1rem">
      <div class="section-header">
        <div class="section-title">Top 10 on PlayzAe.Tv</div>
      </div>
      <div class="top-10-row" id="top-10-row">
        ${renderCardSkeletons(10)}
      </div>
    </div>

    <!-- Genre Filter Carousel -->
    <div class="genre-filter-bar">
      ${GENRES.map(g => `
        <button class="genre-chip ${(AppState.activeGenre === g || (!AppState.activeGenre && g === 'All')) ? 'active' : ''}"
                data-genre="${g}">
          ${g}
        </button>
      `).join('')}
    </div>
    
    <div class="section">
      <div class="section-header">
        <div class="section-title" id="home-section-title">${formatTag}</div>
      </div>
      <div class="grid" id="trending-anime-grid">${renderCardSkeletons(18)}</div>
      <div class="pagination-nav" id="home-pagination"></div>
    </div>
  `;

  // If hero trending cache exists in memory, render immediately with zero delay
  if (heroTrendingCache.length > 0) {
    const randomIdx = Math.floor(Math.random() * Math.min(6, heroTrendingCache.length));
    renderHeroFeatured(heroTrendingCache[randomIdx] || heroTrendingCache[0]);
  }

  // Bind continue watching clicks
  document.querySelectorAll('.continue-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('continue-dismiss-btn')) return;
      const animeId = Number(card.getAttribute('data-resume-id'));
      const prog = getProgressForAnime(animeId);
      if (prog) {
        navigateTo('watch', {
          embed_url: prog.embedUrl,
          lang: prog.lang,
          ep_title: prog.epTitle,
          anime_id: prog.animeId,
          anime_title: prog.animeTitle,
          anime_cover: prog.coverImage,
          anime_banner: prog.bannerImage,
          ep_num: prog.epNumber,
          season_num: 1,
          start_time: prog.savedSeconds
        });
      }
    });
  });

  document.querySelectorAll('.continue-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const animeId = Number(btn.getAttribute('data-dismiss-id'));
      removeWatchProgress(animeId);
      renderHomePage();
    });
  });

  // Bind genre chips
  document.querySelectorAll('.genre-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const genre = chip.getAttribute('data-genre') || 'All';
      AppState.activeGenre = genre === 'All' ? null : genre;
      AppState.currentPageNum = 1;
      document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      loadTrendingSection(1);
    });
  });

  loadTrendingSection(AppState.currentPageNum || 1);
}

async function loadTrendingSection(page = 1) {
  startLoadingBar();
  const grid = document.getElementById('trending-anime-grid');
  const top10Row = document.getElementById('top-10-row');
  const paginationBox = document.getElementById('home-pagination');
  if (!grid) return;

  if (page > 1) {
    grid.innerHTML = renderCardSkeletons(18);
  }

  const fmt = AppState.currentFormatFilter === 'ALL' ? null : AppState.currentFormatFilter;

  try {
    const data = await fetchTrendingAnime(AppState.activeGenre, fmt, page);
    const list = data.results;
    AppState.currentPageNum = data.page;
    AppState.hasNextPage = data.hasNextPage;
    heroTrendingCache = list;

    grid.innerHTML = renderAnimeCards(list);
    bindCardClicks();

    // Render pagination
    if (paginationBox && (data.page > 1 || data.hasNextPage)) {
      paginationBox.innerHTML = renderPagination(data.page, data.hasNextPage);
      bindPaginationClicks(paginationBox, (newPage) => {
        loadTrendingSection(newPage);
        const header = document.getElementById('home-section-title');
        if (header) header.scrollIntoView({ behavior: 'smooth' });
      });
    } else if (paginationBox) {
      paginationBox.innerHTML = '';
    }

    // Render Top 10 Row with Giant Numbers
    if (page === 1 && top10Row && list.length > 0) {
      const top10 = list.slice(0, 10);
      top10Row.innerHTML = top10.map((item, idx) => {
        const cover = (item.coverImage || {}).extraLarge || (item.coverImage || {}).large || '';
        const title = item.title?.english || item.title?.romaji || 'Anime';
        return `
          <div class="top-10-item" data-al-id="${item.id}">
            <span class="top-10-rank">${idx + 1}</span>
            <div class="top-10-card">
              <div class="card-badge-tag ${item.format === 'MOVIE' ? 'movie' : 'tv'}">${item.format === 'MOVIE' ? 'MOVIE' : 'TV'}</div>
              <img src="${cover}" alt="${esc(title)}" loading="lazy">
            </div>
          </div>
        `;
      }).join('');

      top10Row.querySelectorAll('.top-10-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = Number(item.getAttribute('data-al-id'));
          if (id) loadSeriesById(id, item as HTMLElement);
        });
      });
    }

    // Pick random hero on first load
    if (list.length > 0 && page === 1) {
      const randomIdx = Math.floor(Math.random() * Math.min(6, list.length));
      renderHeroFeatured(list[randomIdx] || list[0]);
    }
  } catch {
    grid.innerHTML = `<div class="empty-state">Could not connect to anime catalog server.</div>`;
  } finally {
    finishLoadingBar();
  }
}

function renderHeroFeatured(featured: AnimeMedia) {
  const container = document.getElementById('hero-spotlight-box');
  if (!container || !featured) return;

  const titles = featured.title || {};
  const title = titles.english || titles.romaji || 'Featured Anime';
  const cover = (featured.coverImage || {}).extraLarge || (featured.coverImage || {}).large || '';
  const banner = featured.bannerImage || cover;
  const desc = cleanDesc(featured.description || 'Watch now in high definition on PlayzAe.Tv.');
  const score = featured.averageScore ? `${featured.averageScore}% match` : '90% match';
  const year = featured.seasonYear ? String(featured.seasonYear) : '';
  const format = featured.format || 'TV';
  const genres = (featured.genres || []).slice(0, 3).join(' · ');

  container.innerHTML = `
    <div class="hero-featured-card">
      <img class="hero-featured-bg" src="${banner}" alt="">
      <div class="hero-featured-overlay"></div>
      <div class="hero-featured-content">
        <div class="hero-badge-row">
          <span style="color:var(--accent);font-size:0.75rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase">
            — TRENDING NOW
          </span>
          <span class="hero-stat-chip" style="color:var(--accent);border-color:rgba(16,185,129,0.3)">${score}</span>
          ${year ? `<span class="hero-stat-chip">${year}</span>` : ''}
          <span class="hero-stat-chip">${format === 'MOVIE' ? 'Movie' : 'TV Series'}</span>
          ${genres ? `<span class="hero-stat-chip" style="color:var(--text-muted)">${genres}</span>` : ''}
        </div>
        <h1 class="hero-featured-title" style="font-family:'Bebas Neue','Plus Jakarta Sans',sans-serif;letter-spacing:1px">${esc(title)}</h1>
        <p class="hero-featured-desc">${esc(desc)}</p>
        <div class="hero-featured-actions">
          <button class="btn-play-hero" id="hero-play-btn" style="background:#fff;color:#000;font-weight:800">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Play Now
          </button>
          <button class="btn-hero-details" id="hero-details-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            More Info
          </button>
        </div>
      </div>
      <div class="hero-quick-switch">
        ${heroTrendingCache.slice(0, 5).map(m => {
          const t = m.title?.english || m.title?.romaji || '';
          const c = (m.coverImage || {}).large || (m.coverImage || {}).extraLarge || '';
          return `
            <img class="quick-switch-thumb ${m.id === featured.id ? 'active' : ''}"
                 src="${c}" alt="${esc(t)}" title="${esc(t)}" data-switch-id="${m.id}">
          `;
        }).join('')}
      </div>
    </div>
  `;

  const playBtn = document.getElementById('hero-play-btn');
  if (playBtn) playBtn.addEventListener('click', () => loadSeriesById(featured.id));

  const detailsBtn = document.getElementById('hero-details-btn');
  if (detailsBtn) detailsBtn.addEventListener('click', () => loadSeriesById(featured.id));

  container.querySelectorAll('.quick-switch-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const sId = Number(thumb.getAttribute('data-switch-id'));
      const target = heroTrendingCache.find(x => x.id === sId);
      if (target) renderHeroFeatured(target);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SERIES DETAILS PAGE (PRESERVED EXACTLY AS JACK LOVES)
// ─────────────────────────────────────────────────────────────────────────────
let isLoadingSeries = false;

async function loadSeriesById(alId: number, cardEl?: HTMLElement) {
  if (isLoadingSeries) return;
  isLoadingSeries = true;

  if (cardEl) {
    cardEl.classList.add('is-card-loading');
  }
  startLoadingBar();

  AppState.currentEpIdx = 0;
  AppState.currentEpNumber = 1;

  let skeletonTimer: number | null = null;
  skeletonTimer = window.setTimeout(() => {
    if (AppState.currentPage !== 'series') {
      renderSeriesSkeleton();
    }
  }, 100);

  try {
    const res = await fetchSeriesDetails(alId);
    if (skeletonTimer) window.clearTimeout(skeletonTimer);

    if (res.ok) {
      AppState.isMovie = (res.anime?.format === 'MOVIE');
      AppState.currentEpNumber = 1;
      navigateTo('series', res as unknown as Record<string, unknown>);
    } else {
      toast('Failed to load anime details.');
    }
  } catch {
    if (skeletonTimer) window.clearTimeout(skeletonTimer);
    toast('Network error loading anime.');
  } finally {
    if (cardEl) {
      cardEl.classList.remove('is-card-loading');
    }
    finishLoadingBar();
    isLoadingSeries = false;
  }
}

interface SeasonGroup {
  name: string;
  seasonNum: number;
  items: (EpisodeItem & { _globalIdx: number })[];
}

function partitionEpisodes(episodes: EpisodeItem[]): SeasonGroup[] {
  if (!episodes.length) return [];
  const indexed = episodes.map((ep, idx) => ({ ...ep, _globalIdx: idx }));
  if (indexed.length <= 26) {
    return [{ name: `Episodes 1–${indexed.length}`, seasonNum: 1, items: indexed }];
  }

  const chunkSize = indexed.length > 120 ? 50 : 24;
  const groups: SeasonGroup[] = [];
  let sNum = 1;

  for (let i = 0; i < indexed.length; i += chunkSize) {
    const slice = indexed.slice(i, i + chunkSize);
    const startEp = slice[0].number;
    const endEp = slice[slice.length - 1].number;
    groups.push({
      name: `Season ${sNum} (${startEp}–${endEp})`,
      seasonNum: sNum,
      items: slice
    });
    sNum++;
  }
  return groups;
}

let activeSeasonIdx = 0;
let currentSeasonGroups: SeasonGroup[] = [];

function renderSeriesPage(seriesData: SeriesDetailResponse) {
  const anime = seriesData.anime || {};
  const episodes = seriesData.episodes || [];
  AppState.currentSeriesEpisodes = episodes;
  AppState.isMovie = anime.format === 'MOVIE';

  const titles = anime.title || {};
  const title = titles.english || titles.romaji || 'Untitled Anime';
  const cover = (anime.coverImage || {}).extraLarge || (anime.coverImage || {}).large || '';
  const banner = anime.bannerImage || cover;
  const desc = cleanDesc(anime.description || 'No description available.');
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const studio = anime.studios?.nodes?.[0];
  const genres = anime.genres || [];

  AppState.currentAnimeId = anime.id || 0;
  AppState.currentAnimeTitle = title;
  AppState.currentAnimeCover = cover;
  AppState.currentAnimeBanner = banner;

  currentSeasonGroups = partitionEpisodes(episodes);
  activeSeasonIdx = 0;
  AppState.currentSeasonNum = currentSeasonGroups[0]?.seasonNum || 1;

  const savedProgress = getProgressForAnime(anime.id || 0);

  const view = document.getElementById('page-view');
  if (!view) return;

  view.innerHTML = `
    <div class="series-hero-wrap">
      <img class="series-hero-banner" src="${banner}" alt="">
    </div>

    <div class="series-main">
      <div class="series-header-grid">
        <div class="series-poster-box">
          <img src="${cover}" alt="${esc(title)}">
        </div>
        <div class="series-info-box">
          <h1 class="series-title">${esc(title)}</h1>
          
          <div class="series-pill-row">
            ${anime.status ? `<span class="pill">${anime.status}</span>` : ''}
            ${anime.format ? `<span class="pill">${anime.format}</span>` : ''}
            ${anime.seasonYear ? `<span class="pill">${(anime.season || '') + ' ' + anime.seasonYear}</span>` : ''}
            ${studio ? `<span class="pill">${esc(studio.name)}</span>` : ''}
            ${genres.map(g => `<span class="pill accent">${esc(g)}</span>`).join('')}
          </div>

          <div class="series-stats-bar">
            <div class="stat-item">
              <span class="stat-val">${episodes.length}</span>
              <span class="stat-lbl">${AppState.isMovie ? 'Movie' : 'Episodes'}</span>
            </div>
            ${score ? `
            <div class="stat-item">
              <span class="stat-val">★ ${score}</span>
              <span class="stat-lbl">Rating</span>
            </div>` : ''}
            ${anime.popularity ? `
            <div class="stat-item">
              <span class="stat-val">${(anime.popularity / 1000).toFixed(0)}K</span>
              <span class="stat-lbl">Popularity</span>
            </div>` : ''}
          </div>

          <div class="series-actions">
            ${savedProgress ? `
            <button class="btn-play-hero" id="resume-watch-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Resume Ep ${savedProgress.epNumber} (${formatTime(savedProgress.savedSeconds)})
            </button>
            ` : ''}
            ${episodes.length > 0 ? `
            <button class="btn-play-hero ${savedProgress ? 'secondary' : ''}" id="play-first-ep-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              ${AppState.isMovie ? 'Play Movie' : 'Play Episode 1'}
            </button>` : ''}
          </div>
        </div>
      </div>

      <div class="series-synopsis">${esc(desc)}</div>

      <!-- Episodes Section -->
      <div class="episodes-section">
        <div class="episodes-filter-bar">
          <div class="section-title">Episode Catalog (${episodes.length} Total)</div>
          ${episodes.length > 10 ? `
          <input type="text" id="ep-filter-input" placeholder="Search episode # or title...">
          ` : ''}
        </div>

        <!-- Season Selector Pills -->
        ${currentSeasonGroups.length > 1 ? `
        <div class="season-nav-bar" id="season-pills-bar">
          ${currentSeasonGroups.map((s, idx) => `
            <button class="season-pill ${idx === activeSeasonIdx ? 'active' : ''}" data-season-idx="${idx}">
              ${s.name}
            </button>
          `).join('')}
        </div>
        ` : ''}

        <div class="episodes-grid" id="series-episodes-grid">
          ${renderCurrentSeasonCards()}
        </div>
      </div>
    </div>
  `;

  // Bind play first episode
  const playFirstBtn = document.getElementById('play-first-ep-btn');
  if (playFirstBtn) {
    playFirstBtn.addEventListener('click', () => onEpisodeCardClick(0));
  }

  // Bind resume button if present
  const resumeBtn = document.getElementById('resume-watch-btn');
  if (resumeBtn && savedProgress) {
    resumeBtn.addEventListener('click', () => {
      navigateTo('watch', {
        embed_url: savedProgress.embedUrl,
        lang: savedProgress.lang,
        ep_title: savedProgress.epTitle,
        anime_id: savedProgress.animeId,
        anime_title: savedProgress.animeTitle,
        anime_cover: savedProgress.coverImage,
        anime_banner: savedProgress.bannerImage,
        ep_num: savedProgress.epNumber,
        season_num: 1,
        start_time: savedProgress.savedSeconds
      });
    });
  }

  // Bind season selector pills
  document.querySelectorAll('.season-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sIdx = Number(pill.getAttribute('data-season-idx'));
      activeSeasonIdx = sIdx;
      AppState.currentSeasonNum = currentSeasonGroups[sIdx]?.seasonNum || 1;
      document.querySelectorAll('.season-pill').forEach((p, i) => {
        p.classList.toggle('active', i === sIdx);
      });
      const grid = document.getElementById('series-episodes-grid');
      if (grid) {
        grid.innerHTML = renderCurrentSeasonCards();
        bindEpisodeCards();
      }
    });
  });

  bindEpisodeCards();

  // Episode filter input
  const filterInput = document.getElementById('ep-filter-input') as HTMLInputElement;
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.trim().toLowerCase();
      const grid = document.getElementById('series-episodes-grid');
      if (!grid) return;

      if (!q) {
        grid.innerHTML = renderCurrentSeasonCards();
        bindEpisodeCards();
        return;
      }

      const saved = getProgressForAnime(AppState.currentAnimeId);
      const matched = AppState.currentSeriesEpisodes.map((ep, idx) => ({ ...ep, _globalIdx: idx })).filter(ep => {
        const num = String(ep.number || '');
        const titleText = (ep.title || '').toLowerCase();
        return num.includes(q) || titleText.includes(q);
      });

      if (!matched.length) {
        grid.innerHTML = `<p style="grid-column:1/-1;color:var(--text-dim);padding:2rem;text-align:center">No episodes found matching "${esc(q)}".</p>`;
        return;
      }

      grid.innerHTML = matched.map(ep => {
        const isCurrent = saved && saved.epNumber === ep.number;
        const pct = isCurrent ? Math.min(100, Math.round((saved.savedSeconds / (saved.durationSeconds || 1440)) * 100)) : 0;
        return `
          <div class="ep-card ${isCurrent ? 'active-ep' : ''}" data-global-idx="${ep._globalIdx}">
            ${ep.dub_url ? `<div class="ep-dub-badge">DUB</div>` : ''}
            ${isCurrent ? `<div class="ep-resume-badge">Resuming ${formatTime(saved.savedSeconds)}</div>` : ''}
            <div class="ep-card-num">Episode ${ep.number}</div>
            <div class="ep-card-title">${esc(ep.title || 'Episode ' + ep.number)}</div>
            ${isCurrent ? `
              <div class="continue-bar-track" style="margin-top:0.4rem;height:3px;">
                <div class="continue-bar-fill" style="width:${pct}%;"></div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      bindEpisodeCards();
    });
  }
}

function renderCurrentSeasonCards(): string {
  if (!currentSeasonGroups.length) {
    return `<p style="grid-column:1/-1;color:var(--text-dim);padding:2rem">No episode streams found for this title.</p>`;
  }
  const group = currentSeasonGroups[activeSeasonIdx] || currentSeasonGroups[0];
  const saved = getProgressForAnime(AppState.currentAnimeId);

  return group.items.map(ep => {
    const isCurrent = saved && saved.epNumber === ep.number;
    const pct = isCurrent ? Math.min(100, Math.round((saved.savedSeconds / (saved.durationSeconds || 1440)) * 100)) : 0;
    return `
      <div class="ep-card ${isCurrent ? 'active-ep' : ''}" data-global-idx="${ep._globalIdx}">
        ${ep.dub_url ? `<div class="ep-dub-badge">DUB</div>` : ''}
        ${isCurrent ? `<div class="ep-resume-badge">Resuming ${formatTime(saved.savedSeconds)}</div>` : ''}
        <div class="ep-card-num">Episode ${ep.number}</div>
        <div class="ep-card-title">${esc(ep.title || 'Episode ' + ep.number)}</div>
        ${isCurrent ? `
          <div class="continue-bar-track" style="margin-top:0.4rem;height:3px;">
            <div class="continue-bar-fill" style="width:${pct}%;"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function bindEpisodeCards() {
  document.querySelectorAll('.ep-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = Number(card.getAttribute('data-global-idx'));
      onEpisodeCardClick(idx);
    });
  });
}

function onEpisodeCardClick(globalIndex: number) {
  const ep = AppState.currentSeriesEpisodes[globalIndex];
  if (!ep) return;
  AppState.currentEpIdx = globalIndex;

  const subUrl = ep.sub_url || '';
  const dubUrl = ep.dub_url || '';
  const epTitle = ep.title || `Episode ${ep.number}`;
  AppState.currentEpTitle = epTitle;
  AppState.currentEpNumber = ep.number;

  if (!subUrl && !dubUrl) {
    toast('No stream available for this episode.');
    return;
  }

  if (subUrl && dubUrl) {
    const modal = document.getElementById('lang-modal-box');
    const titleEl = document.getElementById('modal-ep-title');
    const subBtn = document.getElementById('modal-sub-choice');
    const dubBtn = document.getElementById('modal-dub-choice');
    if (!modal || !titleEl || !subBtn || !dubBtn) return;

    titleEl.textContent = `${AppState.currentAnimeTitle} — Episode ${ep.number}`;

    subBtn.onclick = () => {
      modal.style.display = 'none';
      launchWatch(subUrl, 'SUB', epTitle, ep.number);
    };

    dubBtn.onclick = () => {
      modal.style.display = 'none';
      launchWatch(dubUrl, 'DUB', epTitle, ep.number);
    };

    modal.style.display = 'flex';
  } else {
    const chosenUrl = subUrl || dubUrl;
    const chosenLang = subUrl ? 'SUB' : 'DUB';
    launchWatch(chosenUrl, chosenLang, epTitle, ep.number);
  }
}

function launchWatch(embedUrl: string, lang: 'SUB' | 'DUB', epTitle: string, epNumber: number) {
  AppState.currentAudioType = lang;
  AppState.downloadAudioType = lang;
  const saved = getProgressForAnime(AppState.currentAnimeId);
  const startTime = (saved && saved.epNumber === epNumber && saved.savedSeconds > 5) ? saved.savedSeconds : 0;

  navigateTo('watch', {
    embed_url: embedUrl,
    lang,
    ep_title: epTitle,
    ep_num: epNumber,
    anime_id: AppState.currentAnimeId,
    anime_title: AppState.currentAnimeTitle,
    anime_cover: AppState.currentAnimeCover,
    anime_banner: AppState.currentAnimeBanner,
    season_num: AppState.currentSeasonNum,
    start_time: startTime
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCH & DOWNLOAD EXPERIENCE
// ─────────────────────────────────────────────────────────────────────────────
interface WatchPageParams {
  embed_url: string;
  lang?: 'SUB' | 'DUB';
  ep_title?: string;
  ep_num?: number;
  anime_id?: number;
  anime_title?: string;
  anime_cover?: string;
  anime_banner?: string;
  season_num?: number;
  start_time?: number;
}

function renderWatchPage(params: WatchPageParams) {
  const { embed_url, lang, ep_title, start_time } = params;
  AppState.activeMasterUrl = null;
  AppState.activeVariants = [];
  AppState.activeSubtitles = [];
  AppState.selectedSubtitleUrl = null;
  AppState.selectedSubtitleLang = null;
  AppState.currentEpTitle = ep_title || 'Episode Player';
  AppState.currentAudioType = lang || 'SUB';
  AppState.downloadAudioType = lang || 'SUB';
  AppState.currentEmbedUrl = embed_url;

  if (params.anime_id) AppState.currentAnimeId = params.anime_id;
  if (params.anime_title) AppState.currentAnimeTitle = params.anime_title;
  if (params.anime_cover) AppState.currentAnimeCover = params.anime_cover;
  if (params.anime_banner) AppState.currentAnimeBanner = params.anime_banner;
  if (params.season_num) AppState.currentSeasonNum = params.season_num;
  if (params.ep_num) AppState.currentEpNumber = params.ep_num;

  const curEp = AppState.currentSeriesEpisodes[AppState.currentEpIdx];
  const hasDub = Boolean(curEp && curEp.dub_url);
  const hasSub = Boolean(curEp && curEp.sub_url);
  const canSwitchAudio = hasDub && hasSub;

  const hasNext = AppState.currentEpIdx >= 0 && AppState.currentEpIdx < AppState.currentSeriesEpisodes.length - 1;
  const hasPrev = AppState.currentEpIdx > 0;

  // Build iframe URL with ?time=N resume if specified
  let playerUrl = embed_url;
  const initialTime = start_time || 0;
  if (initialTime > 5) {
    playerUrl += (playerUrl.includes('?') ? '&' : '?') + `time=${Math.floor(initialTime)}`;
    toast(`Resumed playback at ${formatTime(initialTime)}`);
  }

  AppState.currentPlaybackSeconds = initialTime;
  AppState.currentDurationSeconds = 1440;

  const view = document.getElementById('page-view');
  if (!view) return;

  const displayHeading = formatEpisodeHeader(AppState.currentEpNumber, ep_title);

  view.innerHTML = `
    <div class="watch-container ${AppState.isTheaterMode ? 'theater' : ''}" id="watch-container-box">
      <div class="watch-top-bar">
        <div class="watch-heading">
          <h2>${esc(displayHeading)}</h2>
          <p>${AppState.currentAnimeTitle} · Season ${AppState.currentSeasonNum} · ${lang || 'SUB'} Stream</p>
        </div>
        <div class="watch-controls-row">
          ${canSwitchAudio ? `
          <button class="nav-btn audio-switch-btn" id="audio-toggle-btn" title="Switch between Subbed & Dubbed audio">
            <span>${lang === 'SUB' ? '🇯🇵 SUB' : '🇺🇸 DUB'}</span>
            <span style="opacity:0.6;font-size:0.75rem">➔ ${lang === 'SUB' ? 'DUB' : 'SUB'}</span>
          </button>
          ` : ''}

          ${hasPrev ? `<button class="nav-btn" id="prev-ep-btn">◄ Prev</button>` : ''}
          ${hasNext ? `<button class="nav-btn" id="next-ep-btn">Next ►</button>` : ''}
          <button class="nav-btn" id="theater-toggle-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
            ${AppState.isTheaterMode ? 'Normal' : 'Theater'}
          </button>
          <button class="nav-btn" id="watch-back-btn">Back</button>
        </div>
      </div>

      <!-- Embedded Video Player Frame -->
      <div class="player-wrapper">
        <iframe id="main-player-frame" src="${playerUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowfullscreen referrerpolicy="origin"></iframe>
      </div>

      <!-- Modern Download Center Card -->
      <div class="download-section-box" id="download-section-box">
        <div class="download-section-header">
          <div class="download-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>${AppState.isMovie ? 'Download Movie (.mp4)' : 'Download Episode (.mp4)'}</span>
          </div>
          <div class="download-ready-tag" id="dl-ready-badge" style="display:none">
            ✓ Direct Download Ready
          </div>
        </div>

        <!-- Preparing Links Progress -->
        <div id="dl-prep-box" class="prep-loader-row">
          <div class="prep-spinner"></div>
          <span>Getting your download links ready...</span>
        </div>

        <!-- Available Quality Download Choices -->
        <div id="dl-ready-box" style="display:none">
          <!-- Audio & Subtitle Selectors -->
          <div style="margin-bottom:1rem">
            <div class="url-label">Audio Stream for Download</div>
            <div class="sub-choice-bar">
              <button class="sub-chip-pill ${AppState.downloadAudioType === 'SUB' ? 'active' : ''}" id="chip-audio-sub">Japanese (SUB)</button>
              <button class="sub-chip-pill ${AppState.downloadAudioType === 'DUB' ? 'active' : ''} ${!hasDub ? 'disabled' : ''}" id="chip-audio-dub">
                ${hasDub ? 'English (DUB)' : 'English (DUB - Unavailable)'}
              </button>
            </div>

            <div class="url-label" style="margin-top:0.6rem">Include Subtitle Track (.vtt companion)</div>
            <div class="sub-choice-bar" id="sub-tracks-chips">
              <button class="sub-chip-pill active" data-sub-url="" data-sub-lang="None">None</button>
            </div>
          </div>

          <div class="url-label">Choose Quality to Download directly to Videos/anime</div>
          <div class="quality-download-grid" id="quality-download-list"></div>
        </div>

        <!-- Live Download Speed & Progress Monitor -->
        <div id="dl-active-monitor" class="download-active-box" style="display:none">
          <div class="download-metrics-row">
            <div class="metric-card">
              <div class="metric-lbl">Downloaded</div>
              <div class="metric-val" id="metric-mb">0.0 MB</div>
            </div>
            <div class="metric-card">
              <div class="metric-lbl">Internet Speed</div>
              <div class="metric-val" id="metric-speed">Calculating...</div>
            </div>
            <div class="metric-card">
              <div class="metric-lbl">Progress</div>
              <div class="metric-val" id="metric-pct">0%</div>
            </div>
            <div class="metric-card">
              <div class="metric-lbl">Segments</div>
              <div class="metric-val" id="metric-segs">0 / 0</div>
            </div>
          </div>
          <div class="dl-progress-track">
            <div class="dl-progress-fill" id="dl-active-fill"></div>
          </div>
          <div class="dl-status-msg" id="dl-active-msg">Connecting to stream server...</div>
        </div>

        <div class="msg-box-done" id="dl-done-box" style="display:none"></div>
        <div class="msg-box-err" id="dl-err-box" style="display:none"></div>
      </div>
    </div>
  `;

  // Start watch progress heartbeat
  AppState.watchTrackerInterval = window.setInterval(() => {
    AppState.currentPlaybackSeconds += 2;
    flushWatchProgress();
  }, 2000);

  // In-Player Audio Switcher (SUB ⮂ DUB)
  const audioSwitchBtn = document.getElementById('audio-toggle-btn');
  if (audioSwitchBtn && curEp) {
    audioSwitchBtn.addEventListener('click', () => {
      const nextLang = AppState.currentAudioType === 'SUB' ? 'DUB' : 'SUB';
      const targetUrl = nextLang === 'DUB' ? curEp.dub_url : curEp.sub_url;
      if (!targetUrl) return;

      AppState.currentAudioType = nextLang;
      AppState.downloadAudioType = nextLang;
      AppState.currentEmbedUrl = targetUrl;

      // Reload iframe preserving current timestamp
      const frame = document.getElementById('main-player-frame') as HTMLIFrameElement;
      if (frame) {
        const timeParam = Math.floor(AppState.currentPlaybackSeconds);
        frame.src = targetUrl + (targetUrl.includes('?') ? '&' : '?') + `time=${timeParam}`;
      }

      toast(`Switched audio to ${nextLang === 'DUB' ? 'English (DUB)' : 'Japanese (SUB)'}`);
      renderWatchPage({
        ...params,
        embed_url: targetUrl,
        lang: nextLang,
        start_time: AppState.currentPlaybackSeconds
      });
    });
  }

  // Download Audio Stream Choice (SUB vs DUB)
  const chipSub = document.getElementById('chip-audio-sub');
  const chipDub = document.getElementById('chip-audio-dub');
  if (chipSub && chipDub && curEp) {
    chipSub.addEventListener('click', () => {
      chipSub.classList.add('active');
      chipDub.classList.remove('active');
      AppState.downloadAudioType = 'SUB';
      if (curEp.sub_url) startCdnExtraction(curEp.sub_url);
    });

    if (hasDub) {
      chipDub.addEventListener('click', () => {
        chipDub.classList.add('active');
        chipSub.classList.remove('active');
        AppState.downloadAudioType = 'DUB';
        if (curEp.dub_url) startCdnExtraction(curEp.dub_url);
      });
    }
  }

  // Bind controls
  const prevBtn = document.getElementById('prev-ep-btn');
  if (prevBtn) prevBtn.addEventListener('click', () => onEpisodeCardClick(AppState.currentEpIdx - 1));

  const nextBtn = document.getElementById('next-ep-btn');
  if (nextBtn) nextBtn.addEventListener('click', () => onEpisodeCardClick(AppState.currentEpIdx + 1));

  const theaterBtn = document.getElementById('theater-toggle-btn');
  if (theaterBtn) {
    theaterBtn.addEventListener('click', () => {
      AppState.isTheaterMode = !AppState.isTheaterMode;
      const box = document.getElementById('watch-container-box');
      if (box) box.classList.toggle('theater', AppState.isTheaterMode);
      theaterBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
        ${AppState.isTheaterMode ? 'Normal' : 'Theater'}
      `;
    });
  }

  const backBtn = document.getElementById('watch-back-btn');
  if (backBtn) backBtn.addEventListener('click', goBack);

  // Trigger CDN stream extraction for downloads
  startCdnExtraction(embed_url);
  AppState.cdnInterval = window.setInterval(pollCdnState, 1200);
}

async function pollCdnState() {
  try {
    const state = await fetchCdnStatus();
    const prepBox = document.getElementById('dl-prep-box');
    const readyBox = document.getElementById('dl-ready-box');
    const readyBadge = document.getElementById('dl-ready-badge');
    const qualityList = document.getElementById('quality-download-list');
    const subChipsBox = document.getElementById('sub-tracks-chips');
    const errBox = document.getElementById('dl-err-box');

    if (!prepBox) return;

    if (state.status === 'done') {
      if (AppState.cdnInterval) {
        window.clearInterval(AppState.cdnInterval);
        AppState.cdnInterval = null;
      }

      prepBox.style.display = 'none';
      if (readyBadge) readyBadge.style.display = 'block';
      if (readyBox) readyBox.style.display = 'block';

      AppState.activeMasterUrl = state.master || null;
      AppState.activeVariants = state.variants || [];
      AppState.activeSubtitles = state.subtitles || [];

      // Render Subtitle chips (clean generic "Subtitles" into English)
      if (subChipsBox && state.subtitles && state.subtitles.length > 0) {
        subChipsBox.innerHTML = `
          <button class="sub-chip-pill ${!AppState.selectedSubtitleUrl ? 'active' : ''}" data-sub-url="" data-sub-lang="None">None</button>
          ${state.subtitles.map(s => {
            const cleanLabel = s.label.toLowerCase() === 'subtitles' ? 'English' : s.label;
            return `
              <button class="sub-chip-pill ${AppState.selectedSubtitleUrl === s.url ? 'active' : ''}"
                      data-sub-url="${esc(s.url)}" data-sub-lang="${esc(cleanLabel)}">
                ${esc(cleanLabel)}
              </button>
            `;
          }).join('')}
        `;

        subChipsBox.querySelectorAll('.sub-chip-pill').forEach(chip => {
          chip.addEventListener('click', () => {
            subChipsBox.querySelectorAll('.sub-chip-pill').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            AppState.selectedSubtitleUrl = chip.getAttribute('data-sub-url') || null;
            AppState.selectedSubtitleLang = chip.getAttribute('data-sub-lang') || null;
          });
        });
      }

      // Render Quality options (with clean 480p, 720p, 1080p tags!)
      if (qualityList) {
        if (state.variants && state.variants.length > 0) {
          qualityList.innerHTML = state.variants.map(v => {
            const kbps = Math.round(v.bandwidth / 1000);
            const { badge, tag } = parseQualityBadge(v.resolution, v.bandwidth);

            return `
              <button class="btn-quality-dl" data-dl-url="${v.url}" data-quality="${tag}">
                <div class="dl-q-left">
                  <span class="dl-q-badge">${badge}</span>
                  <span class="dl-q-res">${v.resolution}</span>
                </div>
                <div class="dl-q-right">
                  <span class="dl-q-bitrate">${kbps} kbps</span>
                  <span class="dl-q-action">⬇ Download .mp4</span>
                </div>
              </button>
            `;
          }).join('');
        } else if (state.master) {
          qualityList.innerHTML = `
            <button class="btn-quality-dl" data-dl-url="${state.master}" data-quality="720p">
              <div class="dl-q-left">
                <span class="dl-q-badge">Original Stream</span>
                <span class="dl-q-res">Standard Quality</span>
              </div>
              <div class="dl-q-right">
                <span class="dl-q-action">⬇ Download .mp4</span>
              </div>
            </button>
          `;
        }

        qualityList.querySelectorAll('.btn-quality-dl').forEach(btn => {
          btn.addEventListener('click', () => {
            const url = btn.getAttribute('data-dl-url') || '';
            const quality = btn.getAttribute('data-quality') || '720p';
            if (url) triggerQualityDownload(url, quality);
          });
        });
      }
    } else if (state.status === 'error') {
      if (AppState.cdnInterval) {
        window.clearInterval(AppState.cdnInterval);
        AppState.cdnInterval = null;
      }
      prepBox.style.display = 'none';
      if (errBox) {
        errBox.textContent = `Could not extract direct stream URL: ${state.error || 'Timeout'}`;
        errBox.style.display = 'block';
      }
    }
  } catch {}
}

async function triggerQualityDownload(streamUrl: string, quality: string) {
  const monitorBox = document.getElementById('dl-active-monitor');
  const doneBox = document.getElementById('dl-done-box');
  const errBox = document.getElementById('dl-err-box');

  if (doneBox) doneBox.style.display = 'none';
  if (errBox) errBox.style.display = 'none';
  if (monitorBox) monitorBox.style.display = 'block';

  document.querySelectorAll('.btn-quality-dl').forEach(btn => {
    (btn as HTMLButtonElement).disabled = true;
    (btn as HTMLElement).style.opacity = '0.45';
  });

  try {
    const res = await startDownload({
      streamUrl,
      animeName: AppState.currentAnimeTitle,
      seasonNum: AppState.currentSeasonNum,
      episodeNum: AppState.currentEpNumber,
      quality,
      audioType: AppState.downloadAudioType,
      subtitleUrl: AppState.selectedSubtitleUrl || undefined,
      subtitleLang: AppState.selectedSubtitleLang || undefined
    });

    if (!res.ok) {
      if (monitorBox) monitorBox.style.display = 'none';
      document.querySelectorAll('.btn-quality-dl').forEach(btn => {
        (btn as HTMLButtonElement).disabled = false;
        (btn as HTMLElement).style.opacity = '1';
      });
      if (errBox) {
        errBox.textContent = res.error || 'Download failed to start.';
        errBox.style.display = 'block';
      }
      return;
    }

    if (AppState.dlInterval) window.clearInterval(AppState.dlInterval);
    AppState.dlInterval = window.setInterval(pollDownloadState, 800);
  } catch {
    if (monitorBox) monitorBox.style.display = 'none';
    if (errBox) {
      errBox.textContent = 'Network error starting download.';
      errBox.style.display = 'block';
    }
  }
}

async function pollDownloadState() {
  try {
    const st = await fetchDownloadStatus();
    const monitorBox = document.getElementById('dl-active-monitor');
    const doneBox = document.getElementById('dl-done-box');
    const errBox = document.getElementById('dl-err-box');

    const fillEl = document.getElementById('dl-active-fill');
    const msgEl = document.getElementById('dl-active-msg');
    const mbEl = document.getElementById('metric-mb');
    const speedEl = document.getElementById('metric-speed');
    const pctEl = document.getElementById('metric-pct');
    const segsEl = document.getElementById('metric-segs');

    if (!monitorBox) return;

    const pct = Math.min(100, Math.max(0, st.progress || 0));
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;

    const mb = st.mb_downloaded || (st.bytes_dl ? st.bytes_dl / (1024 * 1024) : 0);
    if (mbEl) mbEl.textContent = `${mb.toFixed(1)} MB`;

    if (speedEl) {
      speedEl.textContent = st.speed_str || (st.speed_mbps ? `${st.speed_mbps} Mbps` : 'Downloading...');
    }

    if (segsEl) segsEl.textContent = `${st.done_segs} / ${st.total_segs}`;
    if (msgEl) msgEl.textContent = st.message;

    if (st.status === 'done') {
      if (AppState.dlInterval) {
        window.clearInterval(AppState.dlInterval);
        AppState.dlInterval = null;
      }
      if (monitorBox) monitorBox.style.display = 'none';

      document.querySelectorAll('.btn-quality-dl').forEach(btn => {
        (btn as HTMLButtonElement).disabled = false;
        (btn as HTMLElement).style.opacity = '1';
      });

      const filename = st.output_file.split('\\').pop() || 'anime.mp4';
      if (doneBox) {
        doneBox.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem">
            <div>
              <strong>✓ Download Complete:</strong> Saved ${mb.toFixed(1)} MB into Videos/anime as <code>${esc(filename)}</code>
            </div>
            <button class="notif-btn-open" id="done-open-folder-btn" data-file-path="${esc(st.output_file)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Open in Videos Folder
            </button>
          </div>
        `;
        doneBox.style.display = 'block';

        const openBtn = document.getElementById('done-open-folder-btn');
        if (openBtn) {
          openBtn.onclick = () => openFolderInExplorer(st.output_file);
        }
      }

      addCompletedDownload({
        id: `${AppState.currentAnimeId}_${AppState.currentEpNumber}_${Date.now()}`,
        title: AppState.currentEpTitle,
        animeName: AppState.currentAnimeTitle,
        seasonNum: AppState.currentSeasonNum,
        epNum: AppState.currentEpNumber,
        quality: 'MP4',
        audio: AppState.downloadAudioType,
        fileSizeMb: Number(mb.toFixed(1)),
        filePath: st.output_file,
        timestamp: Date.now()
      });

      toast(`Downloaded ${filename} to Videos!`);
    } else if (st.status === 'error') {
      if (AppState.dlInterval) {
        window.clearInterval(AppState.dlInterval);
        AppState.dlInterval = null;
      }
      if (monitorBox) monitorBox.style.display = 'none';

      document.querySelectorAll('.btn-quality-dl').forEach(btn => {
        (btn as HTMLButtonElement).disabled = false;
        (btn as HTMLElement).style.opacity = '1';
      });

      if (errBox) {
        errBox.textContent = `Download Error: ${st.error}`;
        errBox.style.display = 'block';
      }
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH VIEW (WITH ACRONYM EXPANSION)
// ─────────────────────────────────────────────────────────────────────────────
function renderSearchPage(query: string, page = 1) {
  AppState.currentPageNum = page;
  const view = document.getElementById('page-view');
  if (!view) return;

  const targetQuery = resolveSearchQuery(query);

  view.innerHTML = `
    <div class="section" style="padding-top:2rem">
      <div class="section-header">
        <div>
          <div class="section-title">Search Results for "${esc(query)}"</div>
          ${targetQuery.toLowerCase() !== query.toLowerCase() ? `
            <div style="font-size:0.84rem;color:var(--accent);margin-top:4px">
              Expanded acronym: <strong>${esc(targetQuery)}</strong>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="grid" id="search-results-grid">${renderCardSkeletons(12)}</div>
      <div id="search-pagination"></div>
    </div>
  `;

  startLoadingBar();
  searchAnime(targetQuery, page).then(res => {
    finishLoadingBar();
    const grid = document.getElementById('search-results-grid');
    const paginationContainer = document.getElementById('search-pagination');
    if (!grid) return;
    grid.innerHTML = renderAnimeCards(res.results);
    bindCardClicks();

    AppState.hasNextPage = res.hasNextPage;
    if (paginationContainer) {
      paginationContainer.innerHTML = renderPagination(res.page, res.hasNextPage);
      bindPaginationClicks(paginationContainer, (nextPage) => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        renderSearchPage(query, nextPage);
      });
    }
  }).catch(() => {
    finishLoadingBar();
    const grid = document.getElementById('search-results-grid');
    if (grid) grid.innerHTML = `<div class="empty-state">Failed to perform search.</div>`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AD BLOCKER GUIDE (DESKTOP & MOBILE RECOMMENDATIONS)
// ─────────────────────────────────────────────────────────────────────────────
let activeAdblockerDevice: 'desktop' | 'mobile' = 'desktop';

function renderAdBlockersPage() {
  const view = document.getElementById('page-view');
  if (!view) return;

  function getDeviceContentHtml(device: 'desktop' | 'mobile'): string {
    if (device === 'desktop') {
      return `
        <h3 class="guide-section-heading">Best ad blockers for desktop</h3>
        <div class="adblocker-grid">
          <div class="adblocker-item-card">
            <div class="adblocker-item-header">
              <span class="adblocker-name">uBlock Origin</span>
              <span class="adblocker-tag-badge recommended">Recommended</span>
            </div>
            <p class="adblocker-item-desc">
              The gold standard. Lightweight, powerful, and fully open source. Works on Chrome, Firefox, and Edge. Blocks ads, pop-ups, and most tracking.
            </p>
            <a href="https://ublockorigin.com/" target="_blank" rel="noopener noreferrer" class="adblocker-link-btn">
              Get uBlock Origin →
            </a>
          </div>

          <div class="adblocker-item-card">
            <div class="adblocker-item-header">
              <span class="adblocker-name">AdGuard Browser Extension</span>
              <span class="adblocker-tag-badge great">Great</span>
            </div>
            <p class="adblocker-item-desc">
              Feature-rich with a clean UI. Available for Chrome, Firefox, Safari, and Edge. Includes extra privacy protections and a stealth mode.
            </p>
            <a href="https://adguard.com/en/adguard-browser-extension/overview.html" target="_blank" rel="noopener noreferrer" class="adblocker-link-btn">
              Get AdGuard →
            </a>
          </div>

          <div class="adblocker-item-card">
            <div class="adblocker-item-header">
              <span class="adblocker-name">Brave Browser</span>
              <span class="adblocker-tag-badge great">Great</span>
            </div>
            <p class="adblocker-item-desc">
              A privacy-first Chromium browser with built-in ad and tracker blocking. No extensions needed — just install and browse.
            </p>
            <a href="https://brave.com/" target="_blank" rel="noopener noreferrer" class="adblocker-link-btn">
              Get Brave →
            </a>
          </div>
        </div>

        <div class="how-to-box">
          <h4 class="how-to-title">How to install an extension (takes 30 seconds)</h4>
          <div class="how-to-steps">
            <div class="how-to-step-item">
              <div class="step-circle-badge">1</div>
              <div class="step-text">Click the link above for your preferred ad blocker to open the store page.</div>
            </div>
            <div class="how-to-step-item">
              <div class="step-circle-badge">2</div>
              <div class="step-text">Click <strong>Add to Chrome</strong> (or <em>Add to Firefox</em> / <em>Get for Edge</em>).</div>
            </div>
            <div class="how-to-step-item">
              <div class="step-circle-badge">3</div>
              <div class="step-text">Confirm the permissions popup by clicking <strong>Add Extension</strong>.</div>
            </div>
            <div class="how-to-step-item">
              <div class="step-circle-badge">4</div>
              <div class="step-text">Done! Come back to PlayzAe.Tv, refresh the page, and enjoy clean, ad-free streaming.</div>
            </div>
          </div>
        </div>

        <div class="adblocker-note-box">
          <strong>Note on Chrome &amp; Manifest V3:</strong> Google Chrome recently limited some ad blockers. If you run into issues on Chrome, we recommend <strong>Firefox</strong> or <strong>Brave</strong> for the strongest, most consistent ad blocking.
        </div>
      `;
    } else {
      return `
        <h3 class="guide-section-heading">Best options for mobile devices</h3>
        <div class="adblocker-grid">
          <div class="adblocker-item-card">
            <div class="adblocker-item-header">
              <span class="adblocker-name">Brave Browser</span>
              <span class="adblocker-tag-badge recommended">Recommended</span>
            </div>
            <p class="adblocker-item-desc">
              The easiest option for mobile. Built-in ad blocking out of the box with zero setup required. Available for both iOS and Android.
            </p>
            <a href="https://brave.com/" target="_blank" rel="noopener noreferrer" class="adblocker-link-btn">
              Get Brave for Mobile →
            </a>
          </div>

          <div class="adblocker-item-card">
            <div class="adblocker-item-header">
              <span class="adblocker-name">AdGuard App</span>
              <span class="adblocker-tag-badge great">Great</span>
            </div>
            <p class="adblocker-item-desc">
              System-wide and browser ad blocking. Works with Safari on iOS and across browsers on Android. Highly customizable filter rules.
            </p>
            <a href="https://adguard.com/" target="_blank" rel="noopener noreferrer" class="adblocker-link-btn">
              Get AdGuard Mobile →
            </a>
          </div>

          <div class="adblocker-item-card">
            <div class="adblocker-item-header">
              <span class="adblocker-name">Firefox Mobile + uBlock</span>
              <span class="adblocker-tag-badge great">Great</span>
            </div>
            <p class="adblocker-item-desc">
              Android only. Install Firefox from the Play Store, go to Add-ons, and enable uBlock Origin for full desktop-grade ad blocking.
            </p>
            <a href="https://www.mozilla.org/firefox/browsers/mobile/" target="_blank" rel="noopener noreferrer" class="adblocker-link-btn">
              Get Firefox Mobile →
            </a>
          </div>
        </div>

        <div class="how-to-box">
          <h4 class="how-to-title">How to set up mobile ad blocking</h4>
          <div class="how-to-steps">
            <div class="how-to-step-item">
              <div class="step-circle-badge">1</div>
              <div class="step-text">Download your preferred browser or app from the App Store or Google Play.</div>
            </div>
            <div class="how-to-step-item">
              <div class="step-circle-badge">2</div>
              <div class="step-text">Open the app and ensure ad / tracker shields are enabled (enabled by default in Brave).</div>
            </div>
            <div class="how-to-step-item">
              <div class="step-circle-badge">3</div>
              <div class="step-text">Navigate back to <strong>PlayzAe.Tv</strong> in your ad-blocking browser and stream pop-up free!</div>
            </div>
          </div>
        </div>
      `;
    }
  }

  view.innerHTML = `
    <div class="adblocker-page-wrap">
      <div class="adblocker-badge-tag">AD BLOCKER GUIDE</div>
      <h1 class="adblocker-hero-title">Enjoy PlayzAe.Tv Ad-Free</h1>
      <p class="adblocker-hero-subtitle">
        PlayzAe.Tv uses third-party embed servers to play content. Many of these servers show ads or pop-ups. An ad blocker makes the experience dramatically better. Use the guide below to find the right one for you.
      </p>

      <div style="font-size:0.92rem;font-weight:700;color:var(--text-main);margin-bottom:0.75rem">
        What device are you on?
      </div>
      <div class="device-toggle-row">
        <button class="device-card ${activeAdblockerDevice === 'desktop' ? 'active' : ''}" id="device-btn-desktop">
          <div class="device-title">Desktop / Laptop</div>
          <div class="device-desc">Windows, Mac, Linux — using a browser like Chrome, Firefox, or Edge</div>
        </button>
        <button class="device-card ${activeAdblockerDevice === 'mobile' ? 'active' : ''}" id="device-btn-mobile">
          <div class="device-title">Phone / Tablet</div>
          <div class="device-desc">iPhone, Android — using Safari, Chrome, or a browser app</div>
        </button>
      </div>

      <div id="device-content-container">
        ${getDeviceContentHtml(activeAdblockerDevice)}
      </div>

      <p class="adblocker-disclaimer">
        PlayzAe.Tv is not affiliated with any ad blocker mentioned above. We recommend them purely to enhance your streaming experience.
      </p>

      <div class="adblocker-back-action">
        <button class="nav-btn" id="adblocker-page-back-btn" style="border-color:var(--accent);color:var(--accent);padding:0.6rem 1.4rem;font-weight:700">
          ← Back to PlayzAe.Tv
        </button>
      </div>
    </div>
  `;

  const btnDesktop = document.getElementById('device-btn-desktop');
  const btnMobile = document.getElementById('device-btn-mobile');
  const contentContainer = document.getElementById('device-content-container');
  const backBtn = document.getElementById('adblocker-page-back-btn');

  btnDesktop?.addEventListener('click', () => {
    activeAdblockerDevice = 'desktop';
    btnDesktop.classList.add('active');
    btnMobile?.classList.remove('active');
    if (contentContainer) contentContainer.innerHTML = getDeviceContentHtml('desktop');
  });

  btnMobile?.addEventListener('click', () => {
    activeAdblockerDevice = 'mobile';
    btnMobile.classList.add('active');
    btnDesktop?.classList.remove('active');
    if (contentContainer) contentContainer.innerHTML = getDeviceContentHtml('mobile');
  });

  backBtn?.addEventListener('click', () => {
    goBack();
  });
}

function setupNavbarSearch() {
  const input = document.getElementById('nav-search-input') as HTMLInputElement;
  const clearBtn = document.getElementById('nav-search-clear');
  const dropdown = document.getElementById('nav-search-drop');
  if (!input || !dropdown) return;

  let debounceTimer: number | null = null;

  input.addEventListener('input', () => {
    const rawVal = input.value.trim();
    if (clearBtn) clearBtn.style.display = rawVal ? 'block' : 'none';

    if (!rawVal) {
      dropdown.style.display = 'none';
      return;
    }

    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      const q = resolveSearchQuery(rawVal);
      try {
        const results = await searchAnime(q);
        if (!results.length) {
          dropdown.innerHTML = `<div style="padding:1rem;color:var(--text-dim);font-size:0.85rem">No anime found for "${esc(rawVal)}"</div>`;
          dropdown.style.display = 'block';
          return;
        }

        dropdown.innerHTML = results.slice(0, 6).map(item => {
          const title = item.title?.english || item.title?.romaji || 'Anime';
          const cover = (item.coverImage || {}).medium || (item.coverImage || {}).large || '';
          const yr = item.seasonYear ? ` · ${item.seasonYear}` : '';
          return `
            <div class="drop-item" data-drop-id="${item.id}">
              <img class="drop-thumb" src="${cover}" alt="">
              <div class="drop-info">
                <div class="drop-title">${esc(title)}</div>
                <div class="drop-meta">${item.format || 'TV'}${yr}</div>
              </div>
            </div>
          `;
        }).join('');

        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.drop-item').forEach(item => {
          item.addEventListener('click', () => {
            const id = Number(item.getAttribute('data-drop-id'));
            dropdown.style.display = 'none';
            input.value = '';
            if (clearBtn) clearBtn.style.display = 'none';
            if (id) loadSeriesById(id);
          });
        });
      } catch {
        dropdown.style.display = 'none';
      }
    }, 250);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      if (val) {
        dropdown.style.display = 'none';
        navigateTo('search', { query: val });
      }
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      dropdown.style.display = 'none';
      input.focus();
    });
  }

  document.addEventListener('click', (e) => {
    const container = document.getElementById('nav-search-container');
    if (container && !container.contains(e.target as Node)) {
      dropdown.style.display = 'none';
    }
  });
}

function setupMegaBrowseMenu() {
  const trigger = document.getElementById('nav-browse-btn');
  const menu = document.getElementById('nav-browse-menu');
  const wrap = document.getElementById('nav-browse-wrap');
  if (!trigger || !menu) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShown = menu.style.display === 'flex';
    menu.style.display = isShown ? 'none' : 'flex';
  });

  document.addEventListener('click', (e) => {
    if (wrap && !wrap.contains(e.target as Node)) {
      menu.style.display = 'none';
    }
  });

  menu.querySelectorAll('.browse-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const filter = item.getAttribute('data-browse-filter');
      menu.style.display = 'none';
      if (filter === 'movies') {
        AppState.currentFormatFilter = 'MOVIE';
        navigateTo('home');
      } else if (filter === 'popular_tv') {
        AppState.currentFormatFilter = 'TV';
        navigateTo('home');
      } else if (item.id === 'browse-adblockers-btn') {
        navigateTo('adblockers');
      } else {
        AppState.currentFormatFilter = 'ALL';
        navigateTo('home');
      }
    });
  });

  menu.querySelectorAll('.browse-genre-item').forEach(item => {
    item.addEventListener('click', () => {
      const g = item.getAttribute('data-genre');
      menu.style.display = 'none';
      AppState.activeGenre = g;
      AppState.currentFormatFilter = 'ALL';
      navigateTo('home');
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTMESSAGE REMOTE CONTROL LISTENER (BINGR.ONE + MEGAPLAY)
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('message', (e) => {
  try {
    const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (data && typeof data === 'object') {
      // Bingr.one remote status: data.type === 'PLAYER_EVENT' && data.data.event === 'playerstatus'
      if (data.type === 'PLAYER_EVENT' && data.data?.event === 'playerstatus') {
        if (typeof data.data.currentTime === 'number' && !isNaN(data.data.currentTime) && data.data.currentTime > 0) {
          AppState.currentPlaybackSeconds = Math.floor(data.data.currentTime);
        }
        if (typeof data.data.duration === 'number' && !isNaN(data.data.duration) && data.data.duration > 0) {
          AppState.currentDurationSeconds = Math.floor(data.data.duration);
        }
      } else {
        const cur = data.time ?? data.currentTime ?? data.position ?? (data.data && (data.data.time ?? data.data.currentTime));
        if (typeof cur === 'number' && !isNaN(cur) && cur > 0) {
          AppState.currentPlaybackSeconds = Math.floor(cur);
        }
        const dur = data.duration ?? (data.data && data.data.duration);
        if (typeof dur === 'number' && !isNaN(dur) && dur > 0) {
          AppState.currentDurationSeconds = Math.floor(dur);
        }
      }
    }
  } catch {}
});

window.addEventListener('beforeunload', () => {
  flushWatchProgress();
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initThemeColor();
  setupSettingsModal();
  setupNavbarSearch();
  setupNotifications();
  setupMegaBrowseMenu();

  const brand = document.getElementById('brand-logo');
  if (brand) {
    brand.addEventListener('click', () => {
      AppState.currentFormatFilter = 'ALL';
      AppState.activeGenre = null;
      navigateTo('home');
    });
  }

  const homeLink = document.getElementById('nav-home-link');
  if (homeLink) {
    homeLink.addEventListener('click', () => {
      AppState.currentFormatFilter = 'ALL';
      AppState.activeGenre = null;
      navigateTo('home');
    });
  }

  const seriesLink = document.getElementById('nav-series-link');
  if (seriesLink) {
    seriesLink.addEventListener('click', () => {
      AppState.currentFormatFilter = 'TV';
      AppState.activeGenre = null;
      navigateTo('home');
    });
  }

  const moviesLink = document.getElementById('nav-movies-link');
  if (moviesLink) {
    moviesLink.addEventListener('click', () => {
      AppState.currentFormatFilter = 'MOVIE';
      AppState.activeGenre = null;
      navigateTo('home');
    });
  }

  const adblockersLink = document.getElementById('nav-adblockers-link');
  if (adblockersLink) {
    adblockersLink.addEventListener('click', () => {
      navigateTo('adblockers');
    });
  }

  const backBtn = document.getElementById('nav-back-btn');
  if (backBtn) backBtn.addEventListener('click', goBack);

  // Global key navigation
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName)) ||
        (e.altKey && e.key === 'ArrowLeft')) {
      e.preventDefault();
      goBack();
    }
    if (e.key === 'Escape') {
      const modal = document.getElementById('lang-modal-box');
      if (modal && modal.style.display !== 'none') modal.style.display = 'none';
      const settingsModal = document.getElementById('settings-modal-box');
      if (settingsModal && settingsModal.style.display !== 'none') settingsModal.style.display = 'none';
      const drop = document.getElementById('nav-search-drop');
      if (drop) drop.style.display = 'none';
      const notifDrop = document.getElementById('nav-notif-dropdown');
      if (notifDrop) notifDrop.style.display = 'none';
      const browseMenu = document.getElementById('nav-browse-menu');
      if (browseMenu) browseMenu.style.display = 'none';
    }
  });

  navigateTo('home', {}, false);
});
