import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base so the same build works on GitHub Pages (/veg-map/) and on localhost.
export default defineConfig({
  base: './',
  // MapLibre alone is ~1.3 MB minified; it is precached once by the service worker.
  build: { chunkSizeWarningLimit: 1600 },
  // The MapLibre worker is an ES module (it imports shared code), so emit workers as ESM.
  worker: { format: 'es' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['style/*', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '植生マップ',
        short_name: '植生マップ',
        description: '等高線地図の上に植生図（群落名）を表示する、きのこ狩り用オフライン地図',
        lang: 'ja',
        display: 'standalone',
        start_url: './',
        scope: './',
        theme_color: '#2f5d3a',
        background_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // App shell + base style. Vegetation PMTiles are stored in IndexedDB by the app itself.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        globIgnores: ['data/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/gsi-cyberjapan\.github\.io\/optimal_bvmap\/glyphs\//,
            handler: 'CacheFirst',
            options: { cacheName: 'gsi-glyphs' },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/data/prefs.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'pref-index', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
