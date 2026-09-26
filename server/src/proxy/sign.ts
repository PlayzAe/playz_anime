import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/*
 * Every proxy URL carries s = HMAC-SHA256(u + '|' + r). The proxy only serves
 * URLs whose signature checks out, i.e. URLs this server handed out itself, so
 * it can't be used as an open proxy.
 */

function signature(u: string, r: string): string {
  return createHmac('sha256', config.proxySecret).update(`${u}|${r}`).digest('base64url');
}

export function verify(u: string, r: string, s: string): boolean {
  const expected = Buffer.from(signature(u, r));
  const given = Buffer.from(s);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Root-relative by default, so the same URL works through the Vite dev proxy (5311) and in
// production (5310). With PUBLIC_URL set (site hosted elsewhere) they point back at this server.
function build(route: 'hls' | 'file', u: string, r: string): string {
  return `${config.publicUrl}${config.proxyBase}/${route}?u=${encodeURIComponent(u)}&r=${encodeURIComponent(r)}&s=${signature(u, r)}`;
}

/** A playlist: the proxy rewrites every URI inside it. */
export const hlsUrl = (u: string, referer: string) => build('hls', u, referer);

/** Anything else: segments, keys, subtitles, images. */
export const fileUrl = (u: string, referer: string) => build('file', u, referer);
