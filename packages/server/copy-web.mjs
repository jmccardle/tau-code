// Copy the built web client into this package.
//
// The server serves `<this package>/dist-web` at `/`. It used to read the
// sibling `packages/web/dist-web` directly, which works in a checkout and in
// nothing else: not in a published tarball, and not in the container image,
// where only this package is copied.
//
// The root package.json lists packages/web BEFORE packages/server in
// `workspaces` so that npm builds them in that order.
import { cp, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '../web/dist-web');
const TARGET = resolve(HERE, 'dist-web');

try {
  const info = await stat(SOURCE);
  if (!info.isDirectory()) throw new Error('not a directory');
} catch {
  // Fail Early: copying nothing would leave a server that 404s every page and
  // says why only in a browser tab.
  console.error(`copy-web: ${SOURCE} does not exist.`);
  console.error('  Build the web client first: npm run build --workspace @ffwf/tau-code-web');
  process.exit(1);
}

await rm(TARGET, { recursive: true, force: true });
await cp(SOURCE, TARGET, { recursive: true });
