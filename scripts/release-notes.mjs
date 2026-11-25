#!/usr/bin/env node
/**
 * Write the body of a GitHub release from the artifacts that are about to be
 * attached to it.
 *
 *   node scripts/release-notes.mjs dist > NOTES.md
 *
 * The prose of the release is CHANGELOG.md's section for this version, copied
 * in; no section is a refusal, because a release whose notes say nothing about
 * what changed is the one a user cannot decide to install. The targets the
 * release does NOT carry come from build-payload.mjs (`--held`), with why.
 *
 * Everything else here is READ OFF THE ARTIFACTS, not restated from the sources
 * that produced them. The τ version comes from each payload's manifest.json,
 * which build-payload.mjs wrote by reading the dist-info pip left on disk --
 * so these notes say what shipped rather than what was asked for. Sizes are
 * the files' own. The only thing taken from the checkout is the version, and
 * check-version.mjs has already proved that equals the tag.
 *
 * It refuses to write notes for a set of payloads that disagree about τ.
 * Two τs is the failure this whole extension pair is arranged to prevent
 * (ARCHITECTURE 14.3); a release carrying two of them would be that failure
 * shipped once per target, and a release body is far too late to notice it.
 */
import { execFileSync } from 'node:child_process';
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

// --- what changed -----------------------------------------------------------
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const heading = `## ${version}\n`;
const at = changelog.indexOf(heading);
if (at < 0) die(`CHANGELOG.md has no "## ${version}" section. Write it before tagging.`);
const rest = changelog.slice(at + heading.length);
const next = rest.search(/^## /m);
const changes = (next < 0 ? rest : rest.slice(0, next)).trim().replace(/^### /gm, '## ');
if (changes === '') die(`CHANGELOG.md's "## ${version}" section is empty.`);

// --- what is not here, and why ------------------------------------------------
const held = JSON.parse(
  execFileSync(process.execPath, [join(ROOT, 'packages', 'runtime', 'scripts', 'build-payload.mjs'), '--held'], {
    encoding: 'utf8',
  }),
);

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
// The web client `tau serve` answers `GET /` with (ffwf-tau-web) is held to the same rule: one per
// release, and stated. A manifest without it predates the pin and is refused rather than guessed.
const webs = [...new Set(rows.map((row) => row.manifest.tauWebVersion))];
if (webs.some((web) => typeof web !== 'string' || web === '')) {
  die('a manifest has no tauWebVersion: rebuild its payload with this build-payload.mjs.');
}
if (webs.length > 1) die(`these payloads carry ffwf-tau-web ${webs.join(' and ')}.`);
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
    (protocol ? `, speaking protocol ${protocol}` : '') +
    `, with ffwf-tau-web ${webs[0]}.`,
);
lines.push('');
lines.push(changes);
lines.push('');
lines.push('## Install');
lines.push('');
lines.push('Two extensions, and most people want only the first.');
lines.push('');
lines.push(
  `**tau code** is the client. It is universal, ${size(statSync(join(dir, editor)).size)}, and spawns the \`tau\` on your \`PATH\`:`,
);
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
  `Every runtime here was built from one Linux runner. Nothing in what \`tau serve\` imports compiles — ` +
    `the interpreters are prebuilt, and the native wheels (τ's own \`tau._core\`, an abi3 wheel, and ` +
    `\`websockets\`) are published for all ${String(rows.length)} targets — so a cross build is a download and a ` +
    `wheel tag, not a compiler. The build fails on a target rather than shipping a payload missing a module.`,
);
lines.push('');
const heldNames = Object.keys(held);
if (heldNames.length > 0) {
  lines.push('## Runtimes not in this release');
  lines.push('');
  lines.push('| target | why |');
  lines.push('|---|---|');
  for (const name of heldNames) lines.push(`| \`${name}\` | ${held[name]} |`);
  lines.push('');
  lines.push(
    'On these the marketplaces may keep offering an older `ffwf.tau-runtime`, whose τ speaks an older ' +
      'protocol. tau code refuses it before starting anything and says how to fix it: install ' +
      `\`ffwf-tau==${taus[0]}\` yourself and set \`tau-code.binary\` to its \`tau\`, or set ` +
      '`tau-code.runtime` to `system` to use the τ on PATH.',
  );
  lines.push('');
}

process.stdout.write(`${lines.join('\n')}\n`);
