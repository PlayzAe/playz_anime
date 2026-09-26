import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CHROME_UA } from '../http';
import { logger } from '../log';
import { BlockedHostError, guardedFetch } from './guard';
import { rewritePlaylist } from './playlist';
import { verify } from './sign';

const log = logger('proxy');

const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const HEADERS_TIMEOUT = 20_000;
const MONTH = 2_592_000;

// The browser can read these from a proxied response (hls.js needs the length and range).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

// Request headers passed through to the source: byte ranges and cache validation.
const PASS_REQUEST = ['range', 'if-range', 'if-none-match', 'if-modified-since'];
// Response headers passed back. Cookies and the source's own CORS headers stay behind.
const PASS_RESPONSE = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

function isWebUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

/** Reads u, r and s from the query; answers 400/403 itself and returns null when they don't check out. */
function signedTarget(url: URL, res: ServerResponse): { u: string; r: string } | null {
  const u = url.searchParams.get('u') ?? '';
  const r = url.searchParams.get('r') ?? '';
  const s = url.searchParams.get('s') ?? '';
  if (!isWebUrl(u) || (r && !isWebUrl(r))) {
    fail(res, 400, 'Proxy links need a web address.');
    return null;
  }
  if (!s || !verify(u, r, s)) {
    fail(res, 403, 'This link was not issued by this server, or it expired when the server restarted.');
    return null;
  }
  return { u, r };
}

/** The source's own Referer and, for anything but images, its Origin: what the desktop's header rules added. */
function sourceHeaders(r: string, image: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': CHROME_UA, Accept: '*/*' };
  if (r) {
    headers.Referer = r;
    if (!image) headers.Origin = new URL(r).origin;
  }
  return headers;
}

function upstreamError(res: ServerResponse, err: unknown, target: string) {
  if (err instanceof BlockedHostError) return fail(res, 403, err.message);
  const host = (() => {
    try {
      return new URL(target).host;
    } catch {
      return 'the source';
    }
  })();
  const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  log.warn(`${timedOut ? 'timeout' : 'failed'} ${target}:`, err instanceof Error ? err.message : String(err));
  fail(res, timedOut ? 504 : 502, timedOut ? `${host} took too long to answer.` : `Couldn't reach ${host}.`);
}

export function proxyPreflight(res: ServerResponse) {
  res.writeHead(204, {
    ...CORS,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-Range, If-None-Match, If-Modified-Since',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}

// ── /proxy/hls ──────────────────────────────────────────────────────────────

export async function proxyHls(req: IncomingMessage, res: ServerResponse, url: URL) {
  const target = signedTarget(url, res);
  if (!target) return;
  let upstream: Response;
  try {
    upstream = await guardedFetch(target.u, { headers: sourceHeaders(target.r, false), signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return upstreamError(res, err, target.u);
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => {});
    return fail(res, upstream.status === 404 ? 404 : 502, `The stream host answered with HTTP ${upstream.status}.`);
  }
  if (Number(upstream.headers.get('content-length')) > MAX_PLAYLIST_BYTES) {
    await upstream.body?.cancel().catch(() => {});
    return fail(res, 502, 'The stream host sent a playlist that is far too large.');
  }
  let text: string;
  try {
    text = await upstream.text();
  } catch (err) {
    return upstreamError(res, err, target.u);
  }
  if (!text.trimStart().startsWith('#EXTM3U')) return fail(res, 502, 'The stream host did not send a playlist.');

  const body = rewritePlaylist(text, upstream.url || target.u, target.r);
  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Content-Length': Buffer.byteLength(body),
    // Live playlists change between reloads; VOD ones are tiny. Neither is worth caching.
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ── /proxy/file ─────────────────────────────────────────────────────────────

export async function proxyFile(req: IncomingMessage, res: ServerResponse, url: URL) {
  const target = signedTarget(url, res);
  if (!target) return;

  // Sec-Fetch-Dest tells <img> loads apart from hls.js requests, like Electron's resourceType did.
  const dest = String(req.headers['sec-fetch-dest'] ?? '');
  const headers = sourceHeaders(target.r, dest === 'image');
  // Byte counts and ranges must match what the browser receives, so no transfer compression.
  headers['Accept-Encoding'] = 'identity';
  for (const name of PASS_REQUEST) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }

  // Stop the upstream download when the viewer goes away (seeking, closing the tab).
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  const headerTimer = setTimeout(() => abort.abort(new DOMException('No answer in time', 'TimeoutError')), HEADERS_TIMEOUT);

  let upstream: Response;
  try {
    upstream = await guardedFetch(target.u, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: abort.signal });
  } catch (err) {
    clearTimeout(headerTimer);
    if (abort.signal.aborted && res.destroyed) return;
    return upstreamError(res, err, target.u);
  } finally {
    clearTimeout(headerTimer);
  }

  const out: Record<string, string> = { ...CORS };
  for (const name of PASS_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out[name] = value;
  }
  const type = upstream.headers.get('content-type') ?? '';
  // Manga pages, posters and stills never change at the same URL: keep them for a month.
  // Segments dressed up as .jpg arrive through hls.js (dest "empty") and don't count.
  const image = dest === 'image' || (dest !== 'empty' && type.startsWith('image/'));
  if (upstream.ok && image) out['cache-control'] = `public, max-age=${MONTH}, immutable`;
  else if (upstream.ok) out['cache-control'] = upstream.headers.get('cache-control') ?? 'public, max-age=3600';
  else out['cache-control'] = 'no-store';

  res.writeHead(upstream.status, out);
  if (!upstream.body || req.method === 'HEAD' || upstream.status === 304) {
    await upstream.body?.cancel().catch(() => {});
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), res);
  } catch (err) {
    // Viewers abort segment downloads all the time when seeking; only log real failures.
    if (!res.destroyed || !abort.signal.aborted) log.debug(`stream ended early for ${target.u}:`, String(err));
    res.destroy();
  }
}
