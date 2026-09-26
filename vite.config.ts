import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The Node server (server/) answers /api and /proxy on 5310 and, in production,
// serves the built site from dist/. In development Vite serves the page on 5311
// and forwards those two paths to it.
const SERVER = 'http://localhost:5310';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  publicDir: resolve(import.meta.dirname, 'public'),
  // Absolute asset URLs: deep links such as /anime/123 must still find /assets/*.
  // GitHub Pages project sites live under /<repo>/: the Pages workflow sets VITE_BASE.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5311,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/proxy': { target: SERVER, changeOrigin: true },
    },
  },
  preview: {
    port: 5311,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/proxy': { target: SERVER, changeOrigin: true },
    },
  },
});
