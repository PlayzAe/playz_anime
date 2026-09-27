import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

console.log('[test] Compiling API unit tests...');
const started = Date.now();
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['test/apis.test.ts'],
  outfile: 'dist/apis.test.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  tsconfig: 'tsconfig.json',
  external: ['playwright', 'playwright-core'],
  banner: { js: "import { createRequire as __pzRequire } from 'node:module'; const require = __pzRequire(import.meta.url);" },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  sourcemap: 'inline',
  logLevel: 'warning',
});
console.log(`[test] Compiled test bundle in ${Date.now() - started}ms. Running tests...\n`);

const res = spawnSync('node', ['--test', 'dist/apis.test.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

process.exit(res.status ?? 0);
