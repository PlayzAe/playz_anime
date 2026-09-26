import { fileUrl, hlsUrl } from './sign';

/*
 * Rewrites an HLS playlist so every URI in it points back at this proxy:
 * variant and rendition playlists through /proxy/hls (so they get rewritten
 * too), and segments, keys, init sections and the rest through /proxy/file.
 * Relative URIs are resolved against the playlist's own URL first.
 */

// Tags whose URI="" names another playlist rather than a file.
const PLAYLIST_TAG = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT)\b/;
const M3U8 = /\.m3u8(\?|#|$)/i;

function absolute(uri: string, base: string): string | null {
  try {
    const url = new URL(uri, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function rewritePlaylist(text: string, base: string, referer: string): string {
  let nextIsPlaylist = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        if (t.startsWith('#EXT-X-STREAM-INF')) nextIsPlaylist = true;
        const tagIsPlaylist = PLAYLIST_TAG.test(t);
        // #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF, #EXT-X-PART, ...
        // data: and skd: URIs are left alone; only web URLs are fetched through the proxy.
        return t.replace(/URI="([^"]*)"/g, (whole, uri: string) => {
          const abs = absolute(uri, base);
          if (!abs) return whole;
          return `URI="${tagIsPlaylist || M3U8.test(abs) ? hlsUrl(abs, referer) : fileUrl(abs, referer)}"`;
        });
      }
      const abs = absolute(t, base);
      const playlist = nextIsPlaylist || (abs !== null && M3U8.test(abs));
      nextIsPlaylist = false;
      if (!abs) return line;
      return playlist ? hlsUrl(abs, referer) : fileUrl(abs, referer);
    })
    .join('\n');
}
