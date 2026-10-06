import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { EXTENSIONS, FORMATS } from './src/core/formats';

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

// GitHub Pages serves the app from /<repo>/; local builds use the root.
const base = process.env.BASE_PATH ?? '/';

// File Handling API: MIME type → extensions, plus a catch-all since OSes rarely know model MIME types.
const accept: Record<string, string[]> = { 'application/octet-stream': EXTENSIONS };
for (const f of FORMATS) accept[f.mime] = [...new Set([...(accept[f.mime] ?? []), ...f.extensions])];

const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base,
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
        name: '3D Viewer',
        short_name: '3D Viewer',
        description: 'Offline CAD and mesh viewer (STEP, IGES, JT, glTF, OBJ, STL, VRML). Files never leave your device.',
        theme_color: '#1b1d22',
        background_color: '#1b1d22',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        file_handlers: [{ action: base, accept }],
        launch_handler: { client_mode: 'focus-existing' },
      },
    }),
  ],
  worker: { format: 'es' },
});
