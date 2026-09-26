// Development runner: esbuild watches src/ and the shared types, and the server
// restarts after every successful rebuild.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { serverBuildOptions } from './esbuild.config.mjs';

const root = resolve(import.meta.dirname, '..');
const entry = resolve(root, 'dist/index.mjs');

let child = null;
let restartTimer = null;

function start() {
  child = spawn(process.execPath, ['--enable-source-maps', entry], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
  });
  child.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && code) console.error(`[dev] server exited with code ${code}; waiting for the next change`);
    child = null;
  });
}

function restart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!child) return start();
    const old = child;
    old.once('exit', start);
    old.kill('SIGTERM');
  }, 120);
}

const ctx = await esbuild.context({
  ...serverBuildOptions({ dev: true }),
  plugins: [
    {
      name: 'restart-server',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) console.error('[dev] build failed; the running server was kept');
          else restart();
        });
      },
    },
  ],
});
await ctx.watch();
console.log('[dev] watching server/src');

process.on('SIGINT', async () => {
  await ctx.dispose();
  child?.kill('SIGTERM');
  process.exit(0);
});
