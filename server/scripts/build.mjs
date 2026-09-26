import * as esbuild from 'esbuild';
import { serverBuildOptions } from './esbuild.config.mjs';

const started = Date.now();
await esbuild.build(serverBuildOptions({ dev: false }));
console.log(`[build] server/dist/index.mjs in ${Date.now() - started}ms`);
