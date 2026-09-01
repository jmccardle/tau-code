import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The webview bundle.
 *
 * Filenames are fixed rather than content-hashed: the extension builds the
 * webview HTML itself and has to name these files. A hash would mean reading
 * the manifest at activation for no benefit -- the webview is never cached
 * across versions anyway.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-webview',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/webview/main.tsx',
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
      },
    },
  },
});
