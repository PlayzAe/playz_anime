import { MEGAPLAY } from '../sources/anikoto';

/*
 * The desktop loaded any http(s) embed URL in a hidden window. A public server
 * must not fetch whatever URL a caller names, so stream:resolve only accepts
 * players on hosts this server itself put into an episode list.
 */
const known = new Set<string>([new URL(MEGAPLAY).host]);

export function allowEmbedHosts(urls: (string | null | undefined)[]) {
  for (const u of urls) {
    if (!u) continue;
    try {
      const url = new URL(u);
      if (url.protocol === 'https:' || url.protocol === 'http:') known.add(url.host);
    } catch {
      /* not a URL */
    }
  }
}

export function isKnownEmbed(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === 'https:' || url.protocol === 'http:') && known.has(url.host);
  } catch {
    return false;
  }
}
