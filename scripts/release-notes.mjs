#!/usr/bin/env node
/**
 * Write the body of a GitHub release from the artifacts that are about to be
 * attached to it.
 *
 *   node scripts/release-notes.mjs dist > NOTES.md
 *
 * Everything here is READ OFF THE ARTIFACTS, not restated from the sources
 * that produced them. The τ version comes from each payload's manifest.json,
 * which build-payload.mjs wrote by reading the dist-info pip left on disk --
 * so these notes say what shipped rather than what was asked for. Sizes are
 * the files' own. The only thing taken from the checkout is the version, and
 * check-version.mjs has already proved that equals the tag.
 *
 * It refuses to write notes for a set of payloads that disagree about τ.
 * Two τs is the failure this whole extension pair is arranged to prevent
 * (ARCHITECTURE 14.3); a release carrying two of them would be that failure
 * shipped nine times, and a release body is far too late to notice it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function die(message) {
  process.stderr.write(`release-notes: ${message}\n`);
  process.exit(1);
}

const dir = process.argv[2];
if (!dir) die('usage: release-notes.mjs <directory of .vsix and manifest-*.json>');
if (!existsSync(dir)) die(`no such directory: ${dir}`);

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/** KB below a megabyte: `0.2 MB` beside `18.2 MB` hides the whole point of the split. */
function size(bytes) {
  return bytes < 1048576
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}

const files = readdirSync(dir);

// --- the editor extension ---------------------------------------------------
const editor = `ffwf-tau-code-${version}.vsix`;
if (!files.includes(editor)) {
  die(`${editor} is not in ${dir}. The release would be runtimes with no client.`);
}

// --- the runtimes -----------------------------------------------------------
//
// Paired by target: a manifest with no .vsix means a build that produced no
// artifact, and a .vsix with no manifest means one whose contents nothing can
// state. Either way the pairing is the check, so it is done by name.
const manifests = files.filter((name) => /^manifest-.+\.json$/.test(name)).sort();
if (manifests.length === 0) die(`no manifest-<target>.json in ${dir}.`);

const rows = [];
for (const name of manifests) {
  const manifest = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const target = manifest.target;
  if (`manifest-${target}.json` !== name) {
    die(`${name} holds a ${target} payload. The manifest and the file it came from disagree.`);
  }
  const vsix = `ffwf-tau-runtime-${version}-${target}.vsix`;
  if (!files.includes(vsix)) die(`${name} describes a payload, and ${vsix} is not here.`);
  rows.push({ target, vsix, manifest, bytes: statSync(join(dir, vsix)).size });
}

const taus = [...new Set(rows.map((row) => row.manifest.tauVersion))];
if (taus.length > 1) {
  die(
    `these payloads carry ${taus.join(' and ')}. One release may ship exactly one τ: ` +
      `a user whose editor picks the wrong one gets an answer to "which tau is running" that is right ` +
      `on one machine and wrong on the next.`,
  );
}
const pythons = [...new Set(rows.map((row) => row.manifest.pythonVersion))];
if (pythons.length > 1) die(`these payloads carry CPython ${pythons.join(' and ')}.`);

// Only the host's own payload could be executed at build time, so exactly one
// manifest carries a protocol version. Stated when it is there and left out
// when it is not, rather than asserted from the τ version.
const protocol = rows.map((row) => row.manifest.protocolVersion).find(Boolean);

// --- the notes --------------------------------------------------------------
const lines = [];

lines.push(
  `**τ ${taus[0]} on CPython ${pythons[0]}**` +
    (protocol ? `, speaking protocol ${protocol}.` : '.'),
);
lines.push('');
lines.push('## Install');
lines.push('');
lines.push('Two extensions, and most people want only the first.');
lines.push('');
lines.push('**tau code** is the client. It is universal, 170 KB, and spawns the `tau` on your `PATH`:');
lines.push('');
lines.push('```');
lines.push(`code --install-extension ${editor}`);
lines.push('```');
lines.push('');
lines.push(
  '**tau runtime** is optional and carries its own CPython with τ installed into it, for a machine ' +
    'with no Python τ on it. Take the one whose name matches the machine the agent will run on — ' +
    'over SSH or in a devcontainer that is the remote, not your laptop:',
);
lines.push('');
lines.push('```');
lines.push(`code --install-extension ffwf-tau-runtime-${version}-linux-x64.vsix`);
lines.push('```');
lines.push('');
lines.push(
  'Use `codium` instead of `code` for VSCodium. Installing by path is the one thing a marketplace ' +
    'would do for you and does not here: nothing checks that the runtime you picked matches the ' +
    'machine, so picking the wrong one is a spawn error rather than a refusal.',
);
lines.push('');
lines.push('## What is here');
lines.push('');
lines.push('| target | file | size |');
lines.push('|---|---|---|');
lines.push(`| any | \`${editor}\` | ${size(statSync(join(dir, editor)).size)} |`);
for (const row of rows) {
  lines.push(`| \`${row.target}\` | \`${row.vsix}\` | ${size(row.bytes)} |`);
}
lines.push('');
lines.push(
  `Every runtime here was built from one Linux runner. Nothing in τ's RPC closure compiles — ` +
    `the interpreters are prebuilt and the one native wheel, \`pydantic_core\`, publishes for all ` +
    `${String(rows.length)} targets — so a cross build is a download and a wheel tag, not a ` +
    `compiler. The build fails on a target rather than shipping a payload missing a module.`,
);
lines.push('');

process.stdout.write(`${lines.join('\n')}\n`);
