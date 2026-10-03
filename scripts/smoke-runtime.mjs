#!/usr/bin/env node
/**
 * Drive the BUNDLED runtime the way the extension does.
 *
 *   node scripts/build-payload.mjs --target <host>   # in packages/runtime
 *   node scripts/smoke-runtime.mjs
 *
 * `scripts/smoke.mjs` answers "is tau reachable"; this answers a narrower
 * question that nothing else covers: does the chain from the payload's manifest
 * to `tau serve -d --json` to a hello actually hold -- the exact call the
 * extension makes (packages/vscode/src/daemon.ts). Three things in that chain
 * can be wrong in ways that typecheck --
 *
 *   - a manifest naming an interpreter path that is right on the build machine
 *     and wrong once the tree has moved,
 *   - the manifest's args landing on the wrong side of `serve`,
 *   - an interpreter that starts and cannot import tau or websockets, because a
 *     wheel for another platform was resolved,
 *
 * -- and all three surface here as a failed start or hello rather than as a
 * bug report from somebody whose editor said there is no daemon.
 *
 * Sends no prompt, so it costs nothing and needs no reachable model.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILT_AGAINST } from '../packages/protocol/dist/index.js';
import { check, connect, freePort, UNUSED_MODEL } from './lib/daemon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = join(ROOT, 'packages', 'runtime', 'runtime');
const MANIFEST = join(PAYLOAD, 'manifest.json');

if (!existsSync(MANIFEST)) {
  console.error(
    `No payload at ${PAYLOAD}.\n` +
      `  cd packages/runtime && node scripts/build-payload.mjs`,
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const interpreter = join(PAYLOAD, manifest.interpreter);

console.log(`payload ${manifest.target}: tau ${manifest.tauVersion} on Python ${manifest.pythonVersion}`);
console.log(`  ${interpreter}`);
console.log(`  ${[...manifest.args, 'serve', '-d', '--json'].join(' ')}`);

// The manifest's paths are relative BY DESIGN -- the tree is built here and
// unpacked somewhere else on every machine that installs it -- so an absolute
// one is a build that baked in a path and will not survive being moved.
if (isAbsolute(manifest.interpreter) || isAbsolute(manifest.shim)) {
  console.error(
    `\nFAILED: manifest.json names an absolute path (${manifest.interpreter}, ${manifest.shim}).\n` +
      `  Every path in it must be relative to the payload root, or the extension only works\n` +
      `  on the machine that built it.`,
  );
  process.exit(1);
}

// A throwaway HOME, so the daemon this starts is not the user's and does not
// find the user's: `-d` is idempotent, and on the default address it would
// happily report a daemon that is already running instead of starting this one.
const home = mkdtempSync(join(tmpdir(), 'tau-code-smoke-runtime-'));
mkdirSync(join(home, '.tau'), { recursive: true });
writeFileSync(join(home, '.tau', 'config.json'), JSON.stringify(UNUSED_MODEL));
const address = `127.0.0.1:${await freePort()}`;
const env = { HOME: home, PATH: '/usr/bin:/bin' };

let pid = null;
try {
  const printed = execFileSync(interpreter, [...manifest.args, 'serve', '-d', '--json', '--listen', address], {
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const started = JSON.parse(printed);
  pid = started.pid;
  console.log(`\nstarted ${started.started}, pid ${started.pid}, at ${started.address}`);
  check('-d --json names the address it was asked for', started.address === address);
  check('this call started it (the HOME is fresh)', started.started === true);

  const again = JSON.parse(
    execFileSync(interpreter, [...manifest.args, 'serve', '-d', '--json', '--listen', address], { env, encoding: 'utf8' }),
  );
  check('a second -d finds the first instead of starting another', again.started === false && again.pid === pid);

  const client = await connect(`ws://${address}/`, 'smoke-runtime');
  const hello = client.helloResult;
  console.log(`tau serve ${hello.version} at protocol ${hello.protocol}`);
  check(`it speaks the protocol this client was generated against (${BUILT_AGAINST})`, hello.protocol === BUILT_AGAINST);
  // The payload states a protocol version at build time. If the running process
  // disagrees with its own manifest, the manifest is describing a different
  // install than the one that is there.
  check(
    "it agrees with the payload's own manifest",
    !manifest.protocolVersion || manifest.protocolVersion === hello.protocol,
  );
  client.close();

  console.log(process.exitCode ? '\nFAILED' : '\nOK');
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (pid !== null) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone; nothing to stop.
    }
  }
  rmSync(home, { recursive: true, force: true });
}
