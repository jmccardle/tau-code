import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

/**
 * The stale-runtime guard (src/compat.ts): a tau that cannot speak protocol 2 is refused before
 * anything is spawned, with what was found, what is needed and how to fix it.
 *
 * The case it exists for: 0.9.0 drops five runtime targets, and on those the marketplaces keep
 * serving the 0.8.1 runtime -- tau 0.14.1, protocol 1. Its `--version` says `tau 0.14.1` and
 * names no protocol; the runtime API says `tauVersion: "0.14.1"`. Both must be refused.
 *
 * Compiled in memory, as vscode-transport.test.mjs does: the extension only ever reaches a bundle.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', 'src', 'compat.ts');

const compat = await (async () => {
  const { outputFiles } = await build({
    stdin: { contents: readFileSync(SOURCE, 'utf8'), loader: 'ts', resolveDir: dirname(SOURCE), sourcefile: 'compat.ts' },
    format: 'esm',
    platform: 'neutral',
    write: false,
    bundle: true,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
})();

const staleRuntime = {
  kind: 'bundled',
  where: 'the tau runtime extension (linux-armhf, Python 3.11.16)',
  version: '0.14.1',
  protocol: null,
  target: 'linux-armhf',
};
const goodPath = { kind: 'path', where: 'tau on PATH', version: '0.17.1', protocol: 2, target: null };

test('the released runtime targets are build-payload.mjs --list', () => {
  const listed = JSON.parse(
    execFileSync(process.execPath, [join(HERE, '..', '..', 'runtime', 'scripts', 'build-payload.mjs'), '--list'], { encoding: 'utf8' }),
  );
  assert.deepEqual([...compat.RELEASED_RUNTIME_TARGETS], listed);
});

test('parseVersion reads both spellings of `tau --version`', () => {
  assert.deepEqual(compat.parseVersion('tau 0.17.1 (protocol 2)\n'), { version: '0.17.1', protocol: 2 });
  assert.deepEqual(compat.parseVersion('tau 0.14.1\n'), { version: '0.14.1', protocol: null });
  assert.deepEqual(compat.parseVersion('nothing here'), { version: null, protocol: null });
});

test('protocolOf: a named protocol wins; before 0.17.0 is protocol 1; otherwise unknown', () => {
  assert.equal(compat.protocolOf({ ...goodPath, protocol: 3 }), 3);
  assert.equal(compat.protocolOf(staleRuntime), 1);
  assert.equal(compat.protocolOf({ ...staleRuntime, version: '0.16.0' }), 1);
  assert.equal(compat.protocolOf({ ...staleRuntime, version: '0.17.0rc1' }), 1);
  assert.equal(compat.protocolOf({ ...staleRuntime, version: '0.17.0' }), null);
  assert.equal(compat.protocolOf({ ...staleRuntime, version: '0.17.1' }), null);
  assert.equal(compat.protocolOf({ ...staleRuntime, version: '1.0.0' }), null);
  assert.equal(compat.protocolOf({ ...staleRuntime, version: null }), null);
});

test('a tau that speaks protocol 2, or cannot be told yet, passes', () => {
  assert.equal(compat.incompatibility(goodPath, staleRuntime, 2, '0.9.0'), null);
  assert.equal(compat.incompatibility({ ...staleRuntime, version: '0.17.1' }, null, 2, '0.9.0'), null);
  assert.equal(compat.incompatibility({ ...goodPath, version: null, protocol: null }, null, 2, '0.9.0'), null);
});

test('the stale 0.8.1 runtime is refused: found, needed, and the fix', () => {
  const message = compat.incompatibility(staleRuntime, null, 2, '0.9.0');
  assert.ok(message, 'refused');
  // What was found.
  assert.match(message, /tau 0\.14\.1 from the tau runtime extension \(linux-armhf, Python 3\.11\.16\) speaks protocol 1/);
  // What is needed.
  assert.match(message, /tau code 0\.9\.0 speaks protocol 2, which needs tau 0\.17\.0 or newer/);
  // Why there is no newer runtime, and how to fix it without one.
  assert.match(message, /the marketplace has no newer one for linux-armhf, because tau code 0\.9\.0 ships the runtime for linux-x64, linux-arm64, darwin-x64, darwin-arm64 only/);
  assert.match(message, /install tau 0\.17\.1 yourself/);
  assert.match(message, /ffwf-tau==0\.17\.1/);
  assert.match(message, /"tau-code\.binary"/);
  assert.match(message, /uninstall ffwf\.tau-runtime or set "tau-code\.runtime" to "system"/);
});

test('an old runtime on a released target is told to update it', () => {
  const message = compat.incompatibility({ ...staleRuntime, target: 'linux-x64' }, null, 2, '0.9.0');
  assert.match(message, /Update it from the Extensions view: ffwf\.tau-runtime 0\.9\.0 for linux-x64 carries tau 0\.17\.1/);
  assert.doesNotMatch(message, /no newer one/);
});

test('when the losing tau would work, the fix names it rather than an install', () => {
  const message = compat.incompatibility(staleRuntime, goodPath, 2, '0.9.0');
  assert.match(message, /tau 0\.17\.1 from tau on PATH does speak protocol 2/);
  assert.match(message, /set "tau-code\.runtime" to "system"/);
  assert.doesNotMatch(message, /pipx install/);
});

test('an old tau on PATH, in the setting, or in TAU_BIN is refused with a fix for that source', () => {
  const path = compat.incompatibility({ ...staleRuntime, kind: 'path', where: 'tau on PATH' }, null, 2, '0.9.0');
  assert.match(path, /Upgrade the tau on PATH/);
  const setting = compat.incompatibility({ ...staleRuntime, kind: 'setting', where: 'the "tau-code.binary" setting (/opt/tau)' }, null, 2, '0.9.0');
  assert.match(setting, /"tau-code\.binary" names this tau/);
  const env = compat.incompatibility({ ...staleRuntime, kind: 'env', where: 'TAU_BIN (/opt/tau)' }, null, 2, '0.9.0');
  assert.match(env, /TAU_BIN environment variable names this tau/);
  // A future tau that names another protocol is refused the same way.
  const future = compat.incompatibility({ ...goodPath, version: '0.19.0', protocol: 3 }, null, 2, '0.9.0');
  assert.match(future, /tau 0\.19\.0 from tau on PATH speaks protocol 3, newer than the protocol 2/);
  assert.match(future, /Update tau code/);
});
