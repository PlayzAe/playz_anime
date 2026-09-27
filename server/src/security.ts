import type { IncomingMessage, ServerResponse } from 'node:http';

interface ClientTracker {
  count: number;
  resetAt: number;
  blockedUntil: number;
}

// Banned exploit scanners looking for PHP/WordPress/env leaks on non-PHP servers
const SCANNER_PATTERN = /(?:\.env|\.git|\.aws|\.sql|\.bak|\.config|wp-login|wp-admin|xmlrpc\.php|phpmyadmin|cgi-bin|boaform|setup\.cgi|\.php$)/i;

const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_MIN = 180; // Generous for normal users (HLS audio/video streaming + fast page flips)
const clients = new Map<string, ClientTracker>();

// Cleanup stale IP entries periodically to stay well within Render's 512MB RAM
setInterval(() => {
  const now = Date.now();
  for (const [ip, tracker] of clients.entries()) {
    if (now > tracker.resetAt && now > tracker.blockedUntil) {
      clients.delete(ip);
    }
  }
}, 120_000).unref();

export function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') {
    const first = fwd.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Lightweight Zero-Captcha Anti-Bot and DDoS Shield.
 * Filters out automated vulnerability scanners and throttles flood attacks
 * to protect Render free-tier instances (512MB RAM, 0.15 CPU).
 * Returns true if request should be rejected, false if allowed.
 */
export function checkSecurity(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  // 1. Instant drop for known vulnerability probing scripts
  if (SCANNER_PATTERN.test(pathname)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Blocked scanner probe.' }));
    return true;
  }

  const ip = getClientIp(req);
  const now = Date.now();
  let tracker = clients.get(ip);

  if (!tracker || now > tracker.resetAt) {
    tracker = { count: 1, resetAt: now + RATE_WINDOW_MS, blockedUntil: 0 };
    clients.set(ip, tracker);
    return false;
  }

  // 2. Already blocked due to excessive spamming
  if (now < tracker.blockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((tracker.blockedUntil - now) / 1000));
    res.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(retryAfter),
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'Too many requests. Please slow down.', retryAfter }));
    return true;
  }

  tracker.count++;

  // 3. Rate limit threshold exceeded: apply temporary 30-second penalty
  if (tracker.count > MAX_REQUESTS_PER_MIN) {
    tracker.blockedUntil = now + 30_000;
    res.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': '30',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Temporary cooldown.', retryAfter: 30 }));
    return true;
  }

  return false;
}
