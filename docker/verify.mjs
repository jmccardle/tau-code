// Prove the image can start tau and speak the protocol. No model is contacted.
//
// This is the container equivalent of `npm run smoke`: it answers "is the tau
// in this image real and reachable from the Node side", which is the one
// question a two-runtime image can get wrong in a way nothing else catches.
import { spawn } from 'node:child_process';

const bin = process.env.TAU_BIN;
if (!bin) {
  console.error('verify: TAU_BIN is not set.');
  process.exit(1);
}

const tau = spawn(bin, ['--mode', 'rpc'], { stdio: ['pipe', 'pipe', 'inherit'] });
tau.on('error', (error) => {
  console.error(`verify: could not spawn ${bin}: ${error.message}`);
  process.exit(1);
});

const deadline = setTimeout(() => {
  console.error('verify: tau did not answer get_capabilities within 30s.');
  process.exit(1);
}, 30_000);

tau.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_capabilities' })}\n`);

let buffer = '';
tau.stdout.on('data', (chunk) => {
  buffer += chunk;
  const end = buffer.indexOf('\n');
  if (end < 0) return;
  clearTimeout(deadline);
  const reply = JSON.parse(buffer.slice(0, end));
  if (!reply.result?.protocol_version) {
    console.error('verify: get_capabilities did not answer with a protocol version:', reply);
    process.exit(1);
  }
  const { protocol_version: version, commands } = reply.result;
  console.log(`verify: tau speaks protocol ${version}, ${commands.length} commands.`);
  process.exit(0);
});
