import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { AppInfo, BrowseFilters, Chapter, ChapterPage, MangaProviderId, ResolvedStream } from '@shared/types';
import * as anilist from './anilist';
import { assertMediaAllowed, assertUrlAllowed, isHostBlocked, LegalBlock } from './blocklist';
import { config } from './config';
import { listEpisodes } from './episodes';
import { logger } from './log';
import { chapterList, chapterPages, listExtensions, providerHealth, refererFor, toggleExtension, UnknownChapterError } from './manga';
import { readPrefs, type Prefs } from './prefs';
import { proxyFile, proxyHls, proxyPreflight } from './proxy/routes';
import { fileUrl, hlsUrl } from './proxy/sign';
import { checkSecurity } from './security';
import { isKnownEmbed } from './stream/embeds';
import { resolveStream } from './stream/resolve';

/*
 * Every request PlayzAnime Web's server answers, as one (req, res) handler. The
 * Node server (index.ts) and the Vercel functions (api/) both call it.
 */

const log = logger('server');
const MAX_BODY = 256 * 1024;

// ── RPC ─────────────────────────────────────────────────────────────────────

class BadRequest extends Error {}
class RelayOff extends Error {
  constructor() {
    super('This server plays episodes in the source’s own player. Switch the player to Embed.');
  }
}

type Handler = (args: unknown[], prefs: Prefs) => Promise<unknown> | unknown;

const num = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequest(`${name} must be a number.`);
  return n;
};

/** Stream URLs go out as signed proxy URLs; the browser never talks to the CDN directly. */
function proxiedStream(stream: ResolvedStream, referer: string): ResolvedStream {
  return {
    ...stream,
    master: hlsUrl(stream.master, referer),
    variants: stream.variants.map((v) => ({ ...v, url: hlsUrl(v.url, referer) })),
    subtitles: stream.subtitles.map((s) => ({ ...s, url: fileUrl(s.url, referer) })),
  };
}

/** Pages whose host wants the site as Referer go through the proxy; the rest load directly. */
function proxiedPages(pages: ChapterPage[], provider: MangaProviderId): ChapterPage[] {
  const allowed = pages.filter((p) => !isHostBlocked(p.url));
  const referer = refererFor(provider);
  return referer ? allowed.map((p) => ({ ...p, url: fileUrl(p.url, referer) })) : allowed;
}

/** Embeds of the form …/ani/<AniList id>/<episode>/… name their title, so takedowns apply to them directly. */
function embedMediaId(embedUrl: string): number | null {
  const m = /\/ani\/(\d+)\//.exec(embedUrl);
  return m ? Number(m[1]) : null;
}

const HANDLERS: Record<string, Handler> = {
  'anilist:home': ([refresh], p) => anilist.home(p.hideAdult, Boolean(refresh)),
  'anilist:mangaHome': ([refresh], p) => anilist.mangaHome(p.hideAdult, Boolean(refresh)),
  'anilist:browse': ([filters], p) => anilist.browse((filters ?? {}) as BrowseFilters, p.hideAdult),
  'anilist:media': ([id], p) => anilist.mediaFor(num(id, 'id'), p.hideAdult),
  'anilist:schedule': ([from, to], p) => anilist.schedule(num(from, 'from'), num(to, 'to'), p.hideAdult),
  'episodes:list': ([id, refresh]) => {
    const mediaId = num(id, 'mediaId');
    assertMediaAllowed(mediaId);
    return listEpisodes(mediaId, Boolean(refresh));
  },
  'stream:resolve': async ([embedUrl, refresh]) => {
    if (!config.relay) throw new RelayOff();
    if (typeof embedUrl !== 'string' || !isKnownEmbed(embedUrl)) throw new BadRequest('Unknown player address.');
    const mediaId = embedMediaId(embedUrl);
    if (mediaId !== null) assertMediaAllowed(mediaId);
    assertUrlAllowed(embedUrl);
    const { stream, referer } = await resolveStream(embedUrl, Boolean(refresh));
    assertUrlAllowed(stream.master);
    return proxiedStream(stream, referer);
  },
  'manga:chapters': ([id, provider, refresh], p) => {
    const mediaId = num(id, 'mediaId');
    assertMediaAllowed(mediaId);
    return chapterList(mediaId, p, (provider as MangaProviderId | null) ?? null, Boolean(refresh));
  },
  'manga:pages': async ([chapter], p) => {
    const c = chapter as Chapter | undefined;
    if (!c || typeof c.id !== 'string') throw new BadRequest('Unknown chapter.');
    return proxiedPages(await chapterPages(c, p), c.provider);
  },
  'manga:health': ([force]) => providerHealth(Boolean(force)),
  'manga:extensions': () => listExtensions(),
  'manga:toggleExtension': ([id, enabled]) => {
    if (typeof id === 'string') toggleExtension(id, Boolean(enabled));
    return { ok: true };
  },
  // streamRelay tells the page whether to use its own player or the source's embed.
  'app:info': (): AppInfo & { streamRelay: boolean } => ({ version: config.version, platform: 'web', electron: '', chrome: '', userData: '', packaged: true, streamRelay: config.relay }),
};

function readBody(req: IncomingMessage): Promise<string> {
  // Some hosts (Vercel) have already read and parsed the body.
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) return Promise.resolve(typeof pre === 'string' ? pre : Buffer.isBuffer(pre) ? pre.toString('utf8') : JSON.stringify(pre));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BadRequest('Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function statusFor(err: unknown): number {
  if (err instanceof LegalBlock) return 451;
  if (err instanceof RelayOff) return 403;
  if (err instanceof BadRequest || err instanceof SyntaxError || err instanceof UnknownChapterError) return 400;
  return 502;
}

async function rpc(req: IncomingMessage, res: ServerResponse, channel: string) {
  const handler = HANDLERS[channel];
  if (!handler) return sendJson(res, 404, { error: `Unknown channel ${channel}.` });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
  const started = Date.now();
  try {
    const text = await readBody(req);
    const body = text ? (JSON.parse(text) as { args?: unknown }) : {};
    const args = Array.isArray(body.args) ? body.args : [];
    const result = await handler(args, readPrefs(req));
    sendJson(res, 200, result ?? null);
    log.debug(`${channel} ${Date.now() - started}ms`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = statusFor(err);
    log.warn(`${channel} failed (${status}): ${message}`);
    sendJson(res, status, { error: message });
  }
}

// ── Static site (when this server hosts it) ─────────────────────────────────

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (!fs.existsSync(config.distDir)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('The site isn’t built yet. Run the web build, or use the dev server on port 5311.');
    return;
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  let file = path.normalize(path.join(config.distDir, rel));
  if (!file.startsWith(config.distDir)) file = path.join(config.distDir, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(config.distDir, 'index.html'); // SPA fallback
  const ext = path.extname(file).toLowerCase();
  // Hashed build assets never change; the page itself always revalidates.
  const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ── Router ──────────────────────────────────────────────────────────────────

function allowOrigin(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin?.replace(/\/+$/, '');
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-pz-prefs');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
}

/** The proxy routes, at /proxy/* and (for Vercel, where functions live under /api) /api/proxy/*. */
function proxyRoute(pathname: string): 'hls' | 'file' | null {
  const m = /^(?:\/api)?\/proxy\/(hls|file)$/.exec(pathname);
  return m ? (m[1] as 'hls' | 'file') : null;
}

export function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  if (checkSecurity(req, res, pathname)) return;
  return (async () => {
    const route = proxyRoute(pathname);
    if (route) {
      if (req.method === 'OPTIONS') return proxyPreflight(res);
      if (route === 'hls' && !config.relay) return sendJson(res, 403, { error: new RelayOff().message });
      const target = url.searchParams.get('u') ?? '';
      if (isHostBlocked(target)) return sendJson(res, 451, { error: new LegalBlock().message });
      return route === 'hls' ? proxyHls(req, res, url) : proxyFile(req, res, url);
    }
    if (pathname.startsWith('/api/')) {
      allowOrigin(req, res);
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      const m = /^\/api\/rpc\/([a-zA-Z]+:[a-zA-Z]+)$/.exec(pathname);
      return m ? rpc(req, res, m[1]) : sendJson(res, 404, { error: 'Not found.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
    serveStatic(req, res, pathname);
  })().catch((err) => {
    log.error('request failed', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
    else res.destroy();
  });
}
