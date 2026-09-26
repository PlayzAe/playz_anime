import { lookup } from 'node:dns/promises';
import net from 'node:net';

/*
 * The proxy only fetches URLs this server signed, but those include every URI
 * inside upstream playlists, which a CDN controls. So each hop is checked: the
 * host must resolve to public addresses only, never this machine or its network.
 */

const blocked = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation
] as const) {
  blocked.addSubnet(prefix, bits, 'ipv6');
}

export class BlockedHostError extends Error {}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const lower = address.toLowerCase();
  // IPv4 carried inside IPv6 (::ffff:10.0.0.1, 64:ff9b::10.0.0.1) is judged by its IPv4 part.
  const embedded = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (embedded) return blocked.check(embedded, 'ipv4');
  return blocked.check(lower, 'ipv6');
}

/** Throws unless the URL is http(s) and its host resolves only to public addresses. */
export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  const url = typeof raw === 'string' ? new URL(raw) : raw;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BlockedHostError(`Only web addresses can be fetched (${url.protocol}).`);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host)) {
    throw new BlockedHostError(`Refusing to fetch from a local address (${host}).`);
  }
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new BlockedHostError(`Refusing to fetch from a private or local address (${host}).`);
  }
  return url;
}

/**
 * fetch() that re-checks every redirect hop, so a public host can't bounce the
 * request to an internal one.
 */
export async function guardedFetch(raw: string, init: RequestInit & { headers: Record<string, string> }, maxRedirects = 5): Promise<Response> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw new Error('The source redirected too many times.');
    url = await assertPublicUrl(new URL(location, url));
  }
}
