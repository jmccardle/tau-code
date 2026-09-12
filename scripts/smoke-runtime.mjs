#!/usr/bin/env node
/**
 * Drive the BUNDLED runtime the way the extension does.
 *
 *   node scripts/build-payload.mjs --target <host>   # in packages/runtime
 *   node scripts/smoke-runtime.mjs
 *
 * `scripts/smoke.mjs` answers "is tau reachable"; this answers a narrower
 * question that nothing else covers: does the chain from the payload's manifest
 * through `TauProcess.baseArgs` to a negotiated protocol actually hold. Three
 * things in that chain can be wrong in ways that typecheck --
 *
 *   - a manifest naming an interpreter path that is right on the build machine
 *     and wrong once the tree has moved,
 *   - `baseArgs` landing on the wrong side of `--mode rpc`,
 *   - an interpreter that starts and cannot import tau, because a wheel for
 *     another platform was resolved.
 *
 * -- and all three surface here as a failed negotiation rather than as a bug
 * report from somebody whose editor said "tau could not start".
 *
 * Sends no prompt, so it costs nothing and needs no reachable model.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TauClient, commandsOf } from '../packages/protocol/dist/index.js';
import { TauProcess, StdioTransport } from '../packages/runner/dist/index.js';

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
console.log(`  ${[...manifest.args, '--mode', 'rpc'].join(' ')}`);

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

const proc = new TauProcess({
  bin: interpreter,
  baseArgs: manifest.args,
  noSession: true,
});
proc.start((chunk) => process.stderr.write(`[tau stderr] ${chunk}`));

const transport = new StdioTransport(proc, (detail) => console.error('VIOLATION:', detail));
const client = new TauClient(transport);

try {
  const caps = await client.connect();
  console.log(`\nprotocol ${caps.protocol_version} / ${caps.dialect}`);
  console.log(`  ${commandsOf(caps).length} commands`);

  // The payload states a protocol version at build time. If the running process
  // disagrees with its own manifest, the manifest is describing a different
  // install than the one that is there.
  if (manifest.protocolVersion && manifest.protocolVersion !== caps.protocol_version) {
    throw new Error(
      `the payload's manifest says protocol ${manifest.protocolVersion} and the process speaks ` +
        `${caps.protocol_version}.`,
    );
  }

  const state = await client.call('get_state', {});
  console.log(`session ${state.session_id}  status=${state.status}`);

  console.log('\nOK');
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await proc.stop();
}
