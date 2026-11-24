import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tauServeDev } from './dev/serve-record.mjs';

export default defineConfig({
  plugins: [react(), tauServeDev()],
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
