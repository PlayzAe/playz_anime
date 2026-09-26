import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'frontend'),
  build: {
    outDir: resolve(import.meta.dirname, 'website/dist'),
    emptyOutDir: true,
    target: 'esnext',
    minify: 'esbuild'
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
});
