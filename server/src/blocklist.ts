import fs from 'node:fs';
import { config } from './config';
import { logger } from './log';

/*
 * Takedowns. When a valid copyright notice names a title, add its AniList id to
 * `mediaIds` in server/blocklist.json. Episodes, streams and chapters for it are then
 * refused with HTTP 451 (Unavailable For Legal Reasons). A notice naming a source
 * address goes into `hosts`: nothing from that host is loaded or relayed any more.
 * The file is re-read when it changes, so a running server picks edits up at once;
 * on Vercel, commit the change and redeploy.
 */

interface BlocklistFile {
  mediaIds?: number[];
  hosts?: string[];
}

const log = logger('blocklist');
let loadedAt = 0;
let mediaIds = new Set<number>();
let hosts: string[] = [];

function refresh() {
  try {
    const { mtimeMs } = fs.statSync(config.blocklistFile);
    if (mtimeMs === loadedAt) return;
    const data = JSON.parse(fs.readFileSync(config.blocklistFile, 'utf8')) as BlocklistFile;
    mediaIds = new Set((data.mediaIds ?? []).map(Number).filter(Number.isFinite));
    hosts = (data.hosts ?? []).map((h) => h.toLowerCase().trim()).filter(Boolean);
    loadedAt = mtimeMs;
    log.info(`loaded: ${mediaIds.size} titles, ${hosts.length} hosts`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('could not read blocklist', String(err));
  }
}

export class LegalBlock extends Error {
  constructor() {
    super('This title isn’t available on PlayzAnime Web following a copyright notice.');
  }
}

export function assertMediaAllowed(mediaId: number) {
  refresh();
  if (mediaIds.has(mediaId)) throw new LegalBlock();
}

/** A blocked host, or any of its subdomains. */
export function isHostBlocked(url: string): boolean {
  refresh();
  if (!hosts.length) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function assertUrlAllowed(url: string) {
  if (isHostBlocked(url)) throw new LegalBlock();
}
