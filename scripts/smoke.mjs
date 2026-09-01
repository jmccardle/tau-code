#!/usr/bin/env node
/**
 * End-to-end smoke test: spawn tau, negotiate, read state, list what it can do.
 *
 * Sends no prompt, so it costs no tokens and needs no reachable model.
 *
 *   TAU_BIN=/path/to/venv/bin/tau node scripts/smoke.mjs
 */
import { TauClient } from '../packages/protocol/dist/index.js';
import { commandsOf, declinedOf, uiMethodsOf } from '../packages/protocol/dist/index.js';
import { TauProcess, StdioTransport } from '../packages/runner/dist/index.js';

const proc = new TauProcess({ noSession: true });
proc.start((chunk) => process.stderr.write(`[tau stderr] ${chunk}`));

const transport = new StdioTransport(proc, (detail) => console.error('VIOLATION:', detail));
const client = new TauClient(transport);

client.on('protocolViolation', (detail, raw) => console.error('VIOLATION:', detail, raw));
client.on('unknownNotification', (method) => console.log(`  (unknown notification: ${method})`));

try {
  const caps = await client.connect();
  console.log(`protocol ${caps.protocol_version} / ${caps.dialect}`);
  console.log(`  ${commandsOf(caps).length} commands, ${declinedOf(caps).length} declined`);
  console.log(`  reverse channel: ${uiMethodsOf(caps).length > 0 ? 'yes' : 'no (ui_methods is [])'}`);

  const state = await client.call('get_state', {});
  console.log(`session ${state.session_id}  status=${state.status}  addressable=${state.addressable}`);
  console.log(`  model: ${JSON.stringify(state.model)}`);

  const tools = await client.call('get_tools', {});
  const names = (tools.tools ?? []).map((t) => t.name ?? t);
  console.log(`tools (${names.length}): ${names.join(', ')}`);

  console.log('\nOK');
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await proc.stop();
}
