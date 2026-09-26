import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

declare const __APP_VERSION__: string;

/*
 * Everything a deployment can change comes from environment variables, so the
 * same code runs from start.bat, on a Node host, or as Vercel functions.
 * See DEPLOY.md for what each one is for.
 */

// The bundle runs from server/dist (or api/_lib on Vercel), so the server package is one level up.
const serverRoot = path.resolve(import.meta.dirname, '..');
const onVercel = Boolean(process.env.VERCEL);

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

function proxySecret(): string {
  if (process.env.PROXY_SECRET) return process.env.PROXY_SECRET;
  // Serverless runs many copies at once; they must all sign alike, so a random
  // per-process secret won't do. Set PROXY_SECRET; this fallback only keeps things working.
  if (onVercel) return createHash('sha256').update(`playzanime|${process.env.VERCEL_PROJECT_ID ?? ''}|${process.env.VERCEL_ENV ?? ''}`).digest('hex');
  return randomBytes(32).toString('hex');
}

export const config = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  onVercel,
  port: Number(process.env.PORT) || 5310,
  /** Loopback only by default; set HOST=0.0.0.0 to serve other devices on the network. */
  hosts: process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'],
  dev: process.env.NODE_ENV === 'development',
  /** Feed cache and logs. Serverless file systems are read-only except the temp folder. */
  dataDir: onVercel ? path.join(os.tmpdir(), 'playzanime') : path.join(serverRoot, 'data'),
  /** Takedown list (see blocklist.ts); shipped with the code so it works read-only too. */
  blocklistFile: process.env.BLOCKLIST_FILE || path.join(serverRoot, 'blocklist.json'),
  /** The built frontend, served when this server hosts the site itself. */
  distDir: path.resolve(serverRoot, '..', 'dist'),
  /**
   * Where browsers reach this server, when the site is hosted elsewhere (GitHub Pages):
   * proxy URLs are then absolute. Empty means same origin.
   */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Vercel functions live under /api, so the proxies do too there. */
  proxyBase: process.env.PROXY_BASE || (onVercel ? '/api/proxy' : '/proxy'),
  /** Origins allowed to call the RPC cross-origin: the dev server, plus ALLOWED_ORIGINS (for example your GitHub Pages site). */
  allowedOrigins: ['http://localhost:5311', 'http://127.0.0.1:5311', ...list(process.env.ALLOWED_ORIGINS)],
  /**
   * PLAYZANIME_RELAY=off: this server never relays video. Episodes then play in the
   * source's own embedded player, so the server only ever passes along metadata.
   */
  relay: (process.env.PLAYZANIME_RELAY ?? 'on').toLowerCase() !== 'off',
  proxySecret: proxySecret(),
};

fs.mkdirSync(config.dataDir, { recursive: true });
