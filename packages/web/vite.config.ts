import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fontLicences } from '@ffwf/tau-code-ui/vite-fonts';
import { tauServeDev } from './dev/serve-record.mjs';

export default defineConfig({
  plugins: [react(), tauServeDev(), fontLicences()],
  build: {
    // What `tau serve --web-root packages/web/dist` serves. Under τ's CSP (D29 §9: scripts and
    // styles from 'self', inline styles allowed, no inline scripts), which a Vite build meets.
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
