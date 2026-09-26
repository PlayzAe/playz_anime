// Bundles the request handler (src/app.ts) for Vercel: api/_lib/app.mjs, which the
// function files in api/ import. Files and folders starting with "_" aren't functions.
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { serverBuildOptions } from './esbuild.config.mjs';

const root = resolve(import.meta.dirname, '..');
const apiDir = resolve(root, '..', 'api');
mkdirSync(resolve(apiDir, '_lib'), { recursive: true });

const started = Date.now();
await esbuild.build({
  ...serverBuildOptions({ dev: false }),
  entryPoints: ['src/app.ts'],
  outfile: resolve(apiDir, '_lib/app.mjs'),
});
// config.ts looks for blocklist.json one level above the bundle, i.e. in api/.
copyFileSync(resolve(root, 'blocklist.json'), resolve(apiDir, 'blocklist.json'));
console.log(`[build] api/_lib/app.mjs for Vercel in ${Date.now() - started}ms`);
