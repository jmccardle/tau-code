/**
 * Bundle the runtime extension's host entry.
 *
 * The same shape as packages/vscode/esbuild.mjs and for the same reason: the
 * editor loads one CommonJS file and supplies `vscode`. This entry imports no
 * workspace package at all -- it reads a manifest and hands back paths -- so
 * the bundle is a few kilobytes beside a payload of tens of megabytes.
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
  external: ['vscode'],
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
