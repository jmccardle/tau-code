#!/usr/bin/env node
/**
 * Build ffwf-tau-web: packages/web/dist as the Python package `tau_web`, which `tau serve` serves
 * with no flags when it is installed beside τ. Run after `npm run build` (`npm run
 * package:web-wheel` does both):
 *
 *   node scripts/build-web-wheel.mjs              # into dist-py/
 *   node scripts/build-web-wheel.mjs --out DIR    # into DIR (emptied first)
 *
 * Out: `ffwf_tau_web-<version>-py3-none-any.whl` and `ffwf_tau_web-<version>.tar.gz`. The wheel
 * is built FROM the sdist (uv build's default), so a wheel that builds proves the sdist carries
 * the client and needs no Node.
 *
 * What it writes into packages/web-py (all gitignored): `src/tau_web/dist/` (the client),
 * `src/tau_web/_built.py` (the protocol it speaks, from the pinned schema, and the tau-code version
 * it was built from) and `LICENSE` (the repository's). Sourcemaps (`*.map`) are left out. Then it
 * opens what it built and refuses a wheel that is not py3-none-any, has no
 * `tau_web/dist/index.html`, holds a `.map`, or depends on anything
 * (ffwf-tau depends on this package; a dependency back would be circular).
 *
 * Needs `uv` on PATH (it fetches hatchling, the build backend, from PyPI).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'packages/web/dist');
const PY = join(ROOT, 'packages/web-py');
const PKG = join(PY, 'src/tau_web');
const PIN = join(ROOT, 'packages/protocol/schema/protocol.schema.json');
const GENERATED = join(ROOT, 'packages/protocol/src/generated.ts');
const OUT = (() => {
  const index = process.argv.indexOf('--out');
  if (index === -1) return join(ROOT, 'dist-py');
  const path = process.argv[index + 1];
  if (!path) throw new Error('--out needs a directory.');
  return resolve(path);
})();

function die(message) {
  process.stderr.write(`build-web-wheel: ${message}\n`);
  process.exit(1);
}

if (!existsSync(join(CLIENT, 'index.html'))) die(`${CLIENT} has no index.html: run npm run build first`);

// The protocol the client speaks: the pin's, which check:protocol holds to τ and generated.ts to.
const protocol = JSON.parse(readFileSync(PIN, 'utf8'))['x-protocol'];
if (!Number.isInteger(protocol)) die(`${PIN} names no x-protocol`);
const compiled = /export const PROTOCOL = (\d+) as const;/.exec(readFileSync(GENERATED, 'utf8'));
if (!compiled || Number(compiled[1]) !== protocol) {
  die(`generated.ts says protocol ${compiled?.[1]}, the pin says ${protocol}: run npm run generate`);
}
const clientVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

rmSync(join(PKG, 'dist'), { recursive: true, force: true });
// Sourcemaps stay out: they are most of the client's bytes, and τ serves its root to anyone.
// Dev builds and `--web-root` keep them.
cpSync(CLIENT, join(PKG, 'dist'), { recursive: true, filter: (source) => !source.endsWith('.map') });
writeFileSync(
  join(PKG, '_built.py'),
  `"""Written by tau-code's scripts/build-web-wheel.mjs; not committed."""\n\n` +
    `PROTOCOL = ${protocol}\nCLIENT_VERSION = ${JSON.stringify(clientVersion)}\n`,
);
cpSync(join(ROOT, 'LICENSE'), join(PY, 'LICENSE'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
try {
  execFileSync('uv', ['build', '--out-dir', OUT, PY], { stdio: 'inherit' });
} catch (error) {
  die(error.code === 'ENOENT' ? 'no uv on PATH: install uv (https://docs.astral.sh/uv/)' : error.message);
}

// What was built, opened and checked. Python reads the zip and the tarball: no unzip needed.
const built = readdirSync(OUT);
const wheels = built.filter((name) => name.endsWith('.whl'));
const sdists = built.filter((name) => name.endsWith('.tar.gz'));
if (wheels.length !== 1 || sdists.length !== 1) die(`expected one wheel and one sdist in ${OUT}, found ${built.join(', ')}`);
const [wheel] = wheels;
if (!wheel.endsWith('-py3-none-any.whl')) die(`${wheel} is not a pure py3-none-any wheel`);
const INSPECT = `
import sys, tarfile, zipfile
wheel, sdist = sys.argv[1:]
names = zipfile.ZipFile(wheel).namelist()
assert "tau_web/dist/index.html" in names, "the wheel has no tau_web/dist/index.html"
assert "tau_web/_built.py" in names, "the wheel has no tau_web/_built.py"
maps = [n for n in names if n.endswith(".map")]
assert not maps, f"the wheel holds sourcemaps: {maps}"
meta = next(n for n in names if n.endswith(".dist-info/METADATA"))
requires = [l for l in zipfile.ZipFile(wheel).read(meta).decode().splitlines() if l.startswith("Requires-Dist:")]
assert not requires, f"the wheel depends on something: {requires}"
members = tarfile.open(sdist).getnames()
assert any(m.endswith("src/tau_web/dist/index.html") for m in members), "the sdist has no client"
assert not [m for m in members if m.endswith(".map")], "the sdist holds sourcemaps"
print(f"{len(names)} files in the wheel, {len(members)} in the sdist")
`;
execFileSync('python3', ['-I', '-c', INSPECT, join(OUT, wheel), join(OUT, sdists[0])], { stdio: 'inherit' });
process.stdout.write(`ffwf-tau-web: protocol ${protocol}, client ${clientVersion}\n  ${join(OUT, wheel)}\n  ${join(OUT, sdists[0])}\n`);
