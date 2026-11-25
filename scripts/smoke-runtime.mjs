#!/usr/bin/env node
/**
 * Drive the BUNDLED runtime the way the extension does. Run after building this machine's
 * payload and `npm run build`:
 *
 *   npm run payload --workspace packages/runtime
 *   npm run smoke:runtime
 *
 * `scripts/smoke.mjs` answers "does this client speak τ's wire"; this answers a narrower question
 * nothing else covers: does the chain from the payload's manifest, to `tau serve -d --json` in a
 * folder, to the HTTP edge, to `hello` and a reply, hold -- the exact calls the extension makes
 * (packages/vscode/src/serve.ts and relay.ts). Things in that chain can be wrong in ways that
 * typecheck:
 *
 *   - a manifest naming an interpreter path that is right on the build machine and wrong once the
 *     tree has moved,
 *   - the manifest's args landing on the wrong side of `serve`,
 *   - an interpreter that starts and cannot import tau's native module, because a wheel for
 *     another platform was resolved.
 *
 * τ's mock model answers, so it costs nothing and needs no reachable model.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpTransport, PROTOCOL, ServeClient, SessionModel } from '../packages/protocol/dist/index.js';
import { mockConfig, until } from './lib/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = join(ROOT, 'packages', 'runtime', 'runtime');
const MANIFEST = join(PAYLOAD, 'manifest.json');

if (!existsSync(MANIFEST)) {
  console.error(`No payload at ${PAYLOAD}.\n  npm run payload --workspace packages/runtime`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const interpreter = join(PAYLOAD, manifest.interpreter);
const shim = join(PAYLOAD, manifest.shim);
console.log(`payload ${manifest.target}: tau ${manifest.tauVersion} on Python ${manifest.pythonVersion}`);
console.log(`  ${interpreter} ${[...manifest.args, 'serve', '-d', '--json'].join(' ')}`);

// The manifest's paths are relative BY DESIGN -- the tree is built here and unpacked somewhere
// else on every machine that installs it -- so an absolute one will not survive being moved.
assert.ok(
  !isAbsolute(manifest.interpreter) && !isAbsolute(manifest.shim),
  `manifest.json names an absolute path (${manifest.interpreter}, ${manifest.shim})`,
);

// A throwaway HOME (τ home `~/.tau`, the mock model) and folder, so the server this starts is not
// the user's: `-d` is idempotent, and would report a server of the user's instead.
const home = mkdtempSync(join(tmpdir(), 'tau-code-smoke-runtime-'));
mkdirSync(join(home, '.tau'), { recursive: true });
chmodSync(join(home, '.tau'), 0o700);
writeFileSync(join(home, '.tau', 'config.json'), JSON.stringify(mockConfig()));
const work = join(home, 'work');
mkdirSync(work);
const env = { HOME: home, PATH: '/usr/bin:/bin' };
const serve = (...flags) =>
  JSON.parse(execFileSync(interpreter, [...manifest.args, 'serve', ...flags], { env, cwd: work, encoding: 'utf8', timeout: 60_000 }));

let record = null;
let failed = false;
try {
  assert.match(execFileSync(shim, ['--version'], { env, encoding: 'utf8' }), new RegExp(`tau ${manifest.tauVersion.replace(/\./g, '\\.')}`));
  console.log(`ok: the shim runs (${manifest.shim})`);

  record = serve('-d', '--json');
  assert.equal(record.started, true, 'this call started it (the HOME is fresh)');
  assert.equal(record.protocol, PROTOCOL, `it speaks protocol ${PROTOCOL}`);
  assert.equal(record.cwd, work);
  assert.ok(typeof record.url === 'string' && typeof record.token === 'string', 'the record names the HTTP edge and its token');
  console.log(`ok: serve -d started ${record.session} (pid ${record.pid}) at ${record.url}, protocol ${record.protocol}`);
  if (manifest.protocolVersion !== undefined) assert.equal(manifest.protocolVersion, record.protocol, "it agrees with the payload's manifest");

  const again = serve('-d', '--json', '--session', record.session);
  assert.equal(again.started, false);
  assert.equal(again.pid, record.pid);
  console.log('ok: a second -d for the session finds the first');

  const client = new ServeClient(await HttpTransport.open({ url: record.url, token: record.token }));
  const model = new SessionModel();
  client.on('event', (event) => model.hear(event));
  const welcome = await client.hello('smoke@tau-code:runtime');
  model.welcome = welcome;
  assert.equal(welcome.version, manifest.tauVersion);
  const cursor = model.openCursors()[0].cursor;
  await client.call('send', { cursor, text: 'hello from the runtime' });
  let busy = false;
  await until(() => {
    const view = model.views.get(cursor);
    busy ||= view.busy;
    return busy && !view.busy;
  }, 'the step to end', 30_000);
  const walk = await client.call('walk', { id: model.views.get(cursor).at });
  assert.ok(JSON.stringify(walk).includes('mock: hello from the runtime'), 'the walk holds the reply');
  client.close();
  console.log(`ok: hello (τ ${welcome.version}) and a reply over the HTTP edge`);
} catch (error) {
  failed = true;
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  if (record && existsSync(record.log)) console.error(readFileSync(record.log, 'utf8'));
} finally {
  if (record) {
    try {
      serve('--stop', '--json', '--session', record.session);
    } catch {
      try {
        process.kill(record.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
  rmSync(home, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('smoke:runtime: green');
