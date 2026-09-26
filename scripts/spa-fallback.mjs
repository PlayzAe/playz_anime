// GitHub Pages has no rewrites: a deep link like /anime/123 would 404. Pages serves
// 404.html for unknown paths, so it gets a copy of the app, which then reads the
// address and shows the right page. .nojekyll keeps Pages from skipping files.
import { copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'dist');
copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
writeFileSync(resolve(dist, '.nojekyll'), '');
console.log('[pages] dist/404.html and .nojekyll written');
