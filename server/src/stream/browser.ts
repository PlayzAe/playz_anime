import type { Browser } from 'playwright';
import { CHROME_UA } from '../http';
import { logger } from '../log';

const log = logger('browser');

/*
 * The fallback route, the server twin of the desktop's hidden BrowserWindow: open
 * the embed in a headless copy of the system browser (Edge, else Chrome) and
 * note which playlist, getSources and subtitle requests the player makes.
 * Playwright comes from the web project's root node_modules and is only loaded
 * the first time this is needed.
 */

const RESOLVE_TIMEOUT = 25_000;
const GRACE_AFTER_PLAYLIST = 900;
const MAX_PARALLEL = 2;
const IDLE_CLOSE = 2 * 60_000;

// Ad, analytics and beacon hosts the player page pulls in. None of them are needed to reach the playlist.
const BLOCKED_HOSTS =
  /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|statlytic\.net|plausible\.io|cloudflareinsights\.com|tiktokcdn\.com|rtmark\.net|nekostream\.site|jwpltx\.com|llvpn\.com|gstatic\.com)$/i;

export interface Captured {
  playlists: string[];
  subtitles: string[];
  getSources: string | null;
}

// ── Browser lifetime ────────────────────────────────────────────────────────

let browser: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

async function launch(): Promise<Browser> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('This episode needs a browser to start, and Playwright is not installed next to the server.');
  }
  const failures: string[] = [];
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      const b = await chromium.launch({ channel, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
      log.info(`started headless ${channel ?? 'chromium'}`);
      b.on('disconnected', () => (browser = null));
      return b;
    } catch (err) {
      failures.push(`${channel ?? 'chromium'}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  log.warn('no browser could start:', failures.join(' | '));
  throw new Error('This episode needs a browser to start, and neither Microsoft Edge nor Google Chrome could be opened on the server.');
}

function getBrowser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  browser ??= launch().catch((err) => {
    browser = null;
    throw err;
  });
  return browser;
}

/** The browser costs memory while open, so it closes after two quiet minutes. */
function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_CLOSE);
  idleTimer.unref();
}

export async function closeBrowser() {
  const b = browser;
  browser = null;
  if (b) await (await b.catch(() => null))?.close().catch(() => {});
}

// ── Concurrency gate ────────────────────────────────────────────────────────

let running = 0;
const waiting: (() => void)[] = [];

async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
    if (running === 0) scheduleIdleClose();
  }
}

// ── Capture ─────────────────────────────────────────────────────────────────

export function captureFromEmbed(embedUrl: string): Promise<Captured> {
  return gate(async () => {
    const origin = new URL(embedUrl).origin;
    const context = await (await getBrowser()).newContext({
      userAgent: CHROME_UA,
      viewport: { width: 960, height: 540 },
      serviceWorkers: 'block',
    });
    const found: Captured = { playlists: [], subtitles: [], getSources: null };
    try {
      const page = await context.newPage();
      // Popups are ads; close them the moment they open.
      context.on('page', (p) => {
        if (p !== page) void p.close().catch(() => {});
      });
      // Pictures, fonts and video bytes are never needed to reach the playlist request.
      await page.route('**/*', (route) => {
        const req = route.request();
        const type = req.resourceType();
        let host = '';
        try {
          host = new URL(req.url()).hostname;
        } catch {
          /* data: or blob: */
        }
        if (type === 'image' || type === 'font' || type === 'media' || BLOCKED_HOSTS.test(host)) return route.abort();
        return route.continue();
      });

      let sawPlaylist: () => void = () => {};
      const firstPlaylist = new Promise<void>((resolve) => (sawPlaylist = resolve));
      page.on('request', (req) => {
        const u = req.url();
        if (u.includes('ping.gif')) return;
        if (/\.m3u8(\?|$)/i.test(u) && !found.playlists.includes(u)) {
          found.playlists.push(u);
          sawPlaylist();
        } else if (/getSources/i.test(u) && !found.getSources) {
          found.getSources = u;
        } else if (/\.(vtt|srt)(\?|$)/i.test(u) && !found.subtitles.includes(u)) {
          found.subtitles.push(u);
        }
      });

      const deadline = Date.now() + RESOLVE_TIMEOUT;
      try {
        await page.goto(embedUrl, { referer: `${origin}/`, waitUntil: 'commit', timeout: RESOLVE_TIMEOUT });
      } catch (err) {
        throw new Error(`The player page failed to load (${err instanceof Error ? err.message.split('\n')[0] : String(err)}).`);
      }
      const timedOut = await Promise.race([
        firstPlaylist.then(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(true), Math.max(0, deadline - Date.now()))),
      ]);
      // A variant playlist or a second master often follows right after the first.
      if (!timedOut) await new Promise((r) => setTimeout(r, GRACE_AFTER_PLAYLIST));
      if (!found.playlists.length) throw new Error('The player did not start a stream in time.');
      return found;
    } finally {
      await context.close().catch(() => {});
    }
  });
}
