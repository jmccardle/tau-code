import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The webview bundle.
 *
 * Filenames are fixed rather than content-hashed: the extension builds the
 * webview HTML itself and has to name these files. A hash would mean reading
 * the manifest at activation for no benefit -- the webview is never cached
 * across versions anyway. Only the stylesheet is `webview.css`: the fonts it
 * bundles keep their names under `fonts/`, beside their licences.
 */
// A function so the ESM-only font plugin can be imported: this package is CommonJS, so Vite
// loads this config as CommonJS, where a static import of it cannot be required.
export default defineConfig(async () => ({
  plugins: [react(), (await import('@ffwf/tau-code-ui/vite-fonts')).fontLicences()],
  build: {
    outDir: 'dist-webview',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/webview/main.tsx',
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'webview.[ext]' : 'fonts/[name].[ext]'),
      },
    },
  },
}));
