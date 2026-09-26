import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/**
 * One self-contained ESM file. Playwright stays external: it is only loaded when
 * an embed can't be resolved over plain HTTP, and it lives in the web project's
 * root node_modules, which Node finds by walking up from server/dist.
 */
export function serverBuildOptions({ dev }) {
  return {
    absWorkingDir: root,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    tsconfig: 'tsconfig.json',
    external: ['playwright', 'playwright-core'],
    // Bundled CommonJS dependencies call require() for Node built-ins.
    banner: { js: "import { createRequire as __pzRequire } from 'node:module'; const require = __pzRequire(import.meta.url);" },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    sourcemap: dev ? 'inline' : false,
    logLevel: 'warning',
  };
}
