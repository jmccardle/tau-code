/**
 * Bundle the extension host entry.
 *
 * esbuild rather than plain `tsc` for one concrete reason: the workspace
 * packages this imports (`@ffwf/tau-code-runner`, `@ffwf/tau-code-protocol`)
 * are ESM, and
 * a CommonJS extension entry cannot `require` them. Bundling inlines them, so
 * the published extension is one CJS file with `vscode` left external -- the
 * only module the editor supplies at runtime.
 */
import { build, context } from 'esbuild';

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  // Supplied by the editor, never bundled.
  external: ['vscode'],
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
