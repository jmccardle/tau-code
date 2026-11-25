#!/usr/bin/env node
/**
 * ffwf-tau-web installed beside τ: `tau serve` with no `--web-root` serves this checkout's client.
 * Run in an environment that has both (a venv with ffwf-tau and the wheel from
 * `npm run package:web-wheel`):
 *
 *   TAU_BIN=/path/to/venv/bin/tau npm run smoke:web-wheel
 *   TAU_BIN=... WEB_ROOT=installed npm run smoke:browser     # then the whole client, in Chrome
 *
 * What it proves: `python -m tau_web` (the Python beside TAU_BIN) says the client and τ speak the
 * same protocol; `GET /` is packages/web/dist/index.html byte for byte, not τ's help page; every
 * file under packages/web/dist is served as it is on disk, except sourcemaps (`*.map`), which the
 * wheel leaves out and so must be 404. A wheel built from another
 * checkout (or an older one) fails the comparison, which is the point.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, TAU_BIN } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'packages/web/dist');
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`${DIST} has no index.html: run npm run build first`);

// The Python that runs τ: the one beside its console script.
const tau = execFileSync('sh', ['-c', 'command -v "$0"', TAU_BIN], { encoding: 'utf8' }).trim();
const python = join(dirname(tau), 'python');
if (!existsSync(python)) throw new Error(`no python beside ${tau}: set TAU_BIN to a venv's tau`);
process.stdout.write(execFileSync(python, ['-m', 'tau_web', tau], { encoding: 'utf8' }));

const served = await serve();
try {
  const base = served.record.url.replace(/\/$/, '');
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  const page = await index.text();
  assert.ok(!page.includes('<title>tau serve</title>'), 'GET / is τ\'s help page: no tau_web was found');
  assert.equal(page, readFileSync(join(DIST, 'index.html'), 'utf8'), 'GET / is not this checkout\'s index.html');

  const all = readdirSync(DIST, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const files = all.filter((entry) => !entry.name.endsWith('.map'));
  for (const entry of all.filter((entry) => entry.name.endsWith('.map'))) {
    const path = relative(DIST, join(entry.parentPath, entry.name));
    assert.equal((await fetch(`${base}/${path}`)).status, 404, `/${path} is served: the wheel holds a sourcemap`);
  }
  for (const entry of files) {
    const path = relative(DIST, join(entry.parentPath, entry.name));
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200, `GET /${path}`);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(readFileSync(join(DIST, path))), `/${path} differs`);
  }
  console.log(`smoke:web-wheel: ok, / and ${files.length} files served from the installed tau_web, no --web-root; ${all.length - files.length} sourcemaps 404`);
} finally {
  await served.stop();
}
