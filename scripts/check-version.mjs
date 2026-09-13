#!/usr/bin/env node
/**
 * Prove the version in this checkout is one number, and optionally that it is
 * the number a tag claims.
 *
 *   node scripts/check-version.mjs              # every package agrees with the root
 *   node scripts/check-version.mjs v0.5.0       # ...and the root is 0.5.0
 *   EXPECT_VERSION=v0.5.0 node scripts/check-version.mjs
 *
 * Two separate things can go wrong and both are unfixable after a release.
 *
 * One package left behind means one artifact claims a version the others do
 * not have -- a .vsix that says 0.4.1 sitting in a 0.5.0 release, which nobody
 * notices until somebody reports a bug against a version that was never built.
 *
 * A tag that disagrees with the root is the same defect one level up, and it
 * matters here because of how this repository versions: HEAD at a version tag
 * is the released version, and any other commit carries uncommitted
 * functionality. A `v0.5.0` tag on a tree that says 0.4.1 makes that sentence
 * false, and every artifact built from it is named after a version the tag
 * does not point at.
 *
 * The tag argument is optional because the local build has no tag to check
 * against -- scripts/package.sh calls this with nothing and gets the first
 * check only. CI on a tag push calls it with the tag and gets both.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function die(message) {
  process.stderr.write(`check-version: ${message}\n`);
  process.exit(1);
}

function versionOf(manifest) {
  const text = readFileSync(manifest, 'utf8');
  const version = JSON.parse(text).version;
  if (typeof version !== 'string' || version === '') {
    die(`${manifest} has no version.`);
  }
  return version;
}

const root = versionOf(join(ROOT, 'package.json'));

const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const behind = [];
for (const name of packages) {
  const manifest = join(ROOT, 'packages', name, 'package.json');
  const version = versionOf(manifest);
  if (version !== root) behind.push(`  packages/${name} is ${version}, root is ${root}`);
}
if (behind.length > 0) {
  process.stderr.write(`${behind.join('\n')}\n`);
  die(`every package must carry the root version. Fix them and run again.`);
}

// `v0.5.0` and `0.5.0` are the same claim written two ways -- git tags carry
// the `v` by convention here and package.json never does -- so the prefix is
// stripped rather than being a mismatch of its own.
const claimed = (process.argv[2] ?? process.env.EXPECT_VERSION ?? '').trim().replace(/^v/, '');
if (claimed !== '' && claimed !== root) {
  die(
    `this tree is ${root} and the tag claims ${claimed}. ` +
      `A tag names the commit that IS that release; bump the version in the commit the tag points at, ` +
      `or move the tag.`,
  );
}

process.stdout.write(
  `version ${root}: all ${String(packages.length)} packages agree` +
    `${claimed === '' ? '' : `, and the tag says so too`}.\n`,
);
