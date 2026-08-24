import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Second entry point: the marketing site. Builds into docs/, which the deploy
// workflow rsyncs to md-mini.com. emptyOutDir is off because docs/ also holds
// hand-maintained files (screenshot.png, robots.txt, sitemap.xml, favicons,
// llms.txt, sample.md and the internal *.md docs).
export default defineConfig({
  root: fileURLToPath(new URL('./site', import.meta.url)),
  base: '/',
  publicDir: false,
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./docs', import.meta.url)),
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2022',
  },
  server: { port: 1421, strictPort: true },
});
