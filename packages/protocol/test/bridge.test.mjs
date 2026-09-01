/**
 * Tests for the relay rule: a request is answered, never dropped.
 *
 * The bug these exist for: the VS Code host refused to start tau with no
 * folder open, wrote the reason to its log, posted it to a webview that had
 * not loaded yet, and then silently discarded the webview's
 * `get_capabilities`. `TauClient.call` has no deadline, so the panel said
 * `connecting` for as long as it was open.
 *
 *   node --test packages/protocol/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_AGENT, relayRefusal, TauClient, TauRpcError } from '../dist/index.js';

const REASON = 'No folder is open, so there is no working directory for the agent.';

test('a request gets an error response carrying its own id', () => {
  const refusal = relayRefusal({ jsonrpc: '2.0', id: 7, method: 'get_capabilities', params: {} }, REASON);
  assert.deepEqual(refusal, {
    jsonrpc: '2.0',
    id: 7,
    error: { code: NO_AGENT, message: REASON },
  });
});

test('a string id is preserved as a string', () => {
  // Ids belong to the caller. Coercing one would break correlation for a host
  // that uses strings, which JSON-RPC permits.
  const refusal = relayRefusal({ jsonrpc: '2.0', id: 'a1', method: 'prompt' }, REASON);
  assert.equal(refusal.id, 'a1');
});

test('a notification gets no response, because JSON-RPC says so', () => {
  assert.equal(relayRefusal({ jsonrpc: '2.0', method: 'event', params: {} }, REASON), null);
  assert.equal(relayRefusal({ jsonrpc: '2.0', id: null, method: 'event' }, REASON), null);
});

test('anything that is not a request is not answered', () => {
  assert.equal(relayRefusal({ jsonrpc: '2.0', id: 1, result: {} }, REASON), null);
  assert.equal(relayRefusal(null, REASON), null);
  assert.equal(relayRefusal('a line', REASON), null);
  assert.equal(relayRefusal(42, REASON), null);
});

test('the code sits outside the band JSON-RPC and tau have claimed', () => {
  // -32768..-32000 is reserved by the spec, and tau uses -32000..-32004 inside
  // it. A relay error must be neither, or a client cannot tell "tau refused
  // this" from "this never reached tau".
  assert.ok(NO_AGENT < -32768, 'below the reserved floor');
});

test('connect() fails immediately against a relay with no agent', async () => {
  // The whole path, minus React: the client sends `get_capabilities`, a relay
  // that has nothing behind it answers with the refusal, and `connect()`
  // REJECTS. Before the fix the send went nowhere and this promise stayed
  // pending -- which the UI showed as `connecting`, forever.
  const transport = {
    onMessage(handler) {
      this.deliver = handler;
    },
    onClose() {},
    close() {},
    send(message) {
      const refusal = relayRefusal(message, REASON);
      if (refusal) this.deliver(refusal);
    },
  };
  const client = new TauClient(transport);
  await assert.rejects(
    () => client.connect(),
    (error) => error instanceof TauRpcError && error.code === NO_AGENT && error.raw === REASON,
  );
});

test('the reason survives to the client as a sentence, not as a prefix', () => {
  const refusal = relayRefusal({ jsonrpc: '2.0', id: 1, method: 'get_capabilities' }, REASON);
  const error = new TauRpcError('get_capabilities', refusal.error);
  // `message` is for a log and names the request; `raw` is the sentence the
  // host wrote, and it is what the panel shows.
  assert.equal(error.raw, REASON);
  assert.match(error.message, /get_capabilities/);
  assert.equal(error.code, NO_AGENT);
});
