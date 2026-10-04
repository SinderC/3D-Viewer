import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Enforced by the browser: the app may only talk to its own origin, so model data cannot be uploaded.
// Build-only, because the dev server needs inline scripts and a websocket for HMR.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  plugins: [
    react(),
    csp(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      manifest: {
        name: 'STEP Viewer',
        short_name: 'STEP Viewer',
        description: 'Offline STEP AP203/AP214/AP242 viewer. Files never leave your device.',
        theme_color: '#1b1d22',
        background_color: '#1b1d22',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        file_handlers: [
          { action: '/', accept: { 'model/step': ['.stp', '.step'], 'application/octet-stream': ['.stp', '.step'] } },
        ],
        launch_handler: { client_mode: 'focus-existing' },
      },
    }),
  ],
  worker: { format: 'es' },
});
