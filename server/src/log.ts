import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

type Level = 'debug' | 'info' | 'warn' | 'error';

let stream: fs.WriteStream | null = null;
let opened = false;

function file(): fs.WriteStream | null {
  if (opened) return stream;
  opened = true;
  try {
    const dir = path.join(config.dataDir, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'server.log');
    // Keep one previous log around and start fresh each launch.
    if (fs.existsSync(target)) fs.renameSync(target, path.join(dir, 'server.previous.log'));
    stream = fs.createWriteStream(target, { flags: 'a' });
  } catch {
    stream = null;
  }
  return stream;
}

function write(level: Level, scope: string, args: unknown[]) {
  const text = args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${text}`;
  if (level !== 'debug' || config.dev) {
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  }
  file()?.write(line + '\n');
}

export function logger(scope: string) {
  return {
    debug: (...a: unknown[]) => write('debug', scope, a),
    info: (...a: unknown[]) => write('info', scope, a),
    warn: (...a: unknown[]) => write('warn', scope, a),
    error: (...a: unknown[]) => write('error', scope, a),
  };
}
