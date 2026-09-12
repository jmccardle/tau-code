/**
 * Package the runtime extension as one .vsix per platform.
 *
 *   node scripts/package-vsix.mjs                 # whatever runtime/ holds
 *   node scripts/package-vsix.mjs --all           # every target in payloads/
 *
 * A platform-specific .vsix is the whole mechanism this extension relies on:
 * the marketplace serves the build matching the machine asking, and over SSH
 * that machine is the REMOTE one. Which makes the single worst thing this
 * script could do obvious -- ship one platform's binaries under another
 * platform's target -- so it refuses to package unless the payload's own
 * manifest names the target being passed to vsce.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..');

function die(message) {
  process.stderr.write(`package-vsix: ${message}\n`);
  process.exit(1);
}

function say(message) {
  process.stderr.write(`${message}\n`);
}

const version = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;

/**
 * vsce packages the directory it is run in, and reads `runtime/` from there.
 * With `--all` each target's tree lives under payloads/<target>/runtime, so the
 * tree is swapped into place one at a time rather than nine copies of the
 * extension existing on disk.
 */
function packageOne(target) {
  const manifestPath = join(PKG_ROOT, 'runtime', 'manifest.json');
  if (!existsSync(manifestPath)) {
    die(
      `no runtime/manifest.json. Build a payload first:\n` +
        `  node scripts/build-payload.mjs --target ${target ?? '<target>'}`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const built = manifest.target;

  if (target && built !== target) {
    die(
      `runtime/ holds a ${built} payload and you asked to package it as ${target}. ` +
        `That .vsix would carry ${built} binaries to every ${target} machine that installed it, ` +
        `and the failure lands on the user as a spawn error with no cause in it.`,
    );
  }

  const out = join(REPO_ROOT, `ffwf-tau-runtime-${version}-${built}.vsix`);
  say(`\n=== ${built}  tau ${manifest.tauVersion}  ->  ${out}`);

  const result = spawnSync(
    'npx',
    [
      '--yes',
      '@vscode/vsce',
      'package',
      // esbuild bundles the entry, so nothing under node_modules is needed and
      // vsce would otherwise walk the workspace-hoisted tree above this one.
      '--no-dependencies',
      '--target',
      built,
      '--out',
      out,
    ],
    { cwd: PKG_ROOT, stdio: 'inherit' },
  );
  if (result.status !== 0) die(`vsce exited ${String(result.status)}`);

  say(`  ${(statSync(out).size / 1048576).toFixed(1)} MB`);
  return out;
}

const all = process.argv.includes('--all');
const flag = process.argv.indexOf('--target');
const asked = flag >= 0 ? process.argv[flag + 1] : null;

if (!all) {
  packageOne(asked);
} else {
  const payloads = join(PKG_ROOT, 'payloads');
  if (!existsSync(payloads)) {
    die(`no payloads/ directory. Build every target first:\n  node scripts/build-payload.mjs --all`);
  }
  const live = join(PKG_ROOT, 'runtime');
  const parked = join(PKG_ROOT, 'runtime.parked');
  if (existsSync(live)) renameSync(live, parked);
  try {
    for (const target of readdirSync(payloads)) {
      renameSync(join(payloads, target, 'runtime'), live);
      try {
        packageOne(target);
      } finally {
        renameSync(live, join(payloads, target, 'runtime'));
      }
    }
  } finally {
    if (existsSync(parked)) renameSync(parked, live);
  }
}
