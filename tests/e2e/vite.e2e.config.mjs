/**
 * Dev server for the e2e suite when other people are editing the sources: the same app and module graph as `npm run dev`
 * (so the suite's read-only store probes work), but with HMR off - a file saved mid-run no longer reloads the page and
 * wipes the flow's scenario. Separate dep cache so it never fights the main dev server's optimizer.
 *
 *   node tests/e2e/run.cjs --isolated      (starts this on :5174, runs, stops it)
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root,
  base: './',
  configFile: false,
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-e2e', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  worker: { format: 'es' },
  server: { hmr: false },
  logLevel: 'warn',
});
