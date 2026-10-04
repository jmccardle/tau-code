import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, ServeClient, ServeError, ProtocolVersionError, PROTOCOL_VERSION } from '../dist/index.js';

/** A transport whose far end is this test. */
function pair() {
  const sent = [];
  let deliver = () => {};
  let close = () => {};
  const transport = {
    send: (frame) => sent.push(frame),
    onMessage: (handler) => (deliver = handler),
    onClose: (handler) => (close = handler),
    close: () => {},
  };
  return { transport, sent, deliver: (frame) => deliver(frame), close: (...args) => close(...args) };
}

test('a request is a JSON-RPC 2.0 frame, and resolves with the result', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.request('list_sessions', {});
  assert.deepEqual(peer.sent, [{ jsonrpc: '2.0', id: 1, method: 'list_sessions', params: {} }]);
  peer.deliver({ jsonrpc: '2.0', id: 1, result: [] });
  assert.deepEqual(await answer, []);
});

test('hello names the generated protocol version', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.hello('tau-code-test', null);
  assert.equal(peer.sent[0].method, 'hello');
  assert.equal(peer.sent[0].params.protocol, PROTOCOL_VERSION);
  assert.equal(peer.sent[0].params.token, null);
  peer.deliver({ jsonrpc: '2.0', id: 1, result: null });
  await answer;
});

test('a PROTOCOL_MISMATCH refusal is a ProtocolVersionError and closes the client', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.hello('tau-code-test', null);
  peer.deliver({
    jsonrpc: '2.0',
    id: 1,
    error: { code: ERROR_CODES.PROTOCOL_MISMATCH, message: 'this daemon speaks 9.9', data: null },
  });
  await assert.rejects(answer, ProtocolVersionError);
  assert.equal(client.closed, true);
});

test("an error keeps τ's sentence verbatim as detail, and its data", async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.request('detach', { session_id: 's' });
  peer.deliver({ jsonrpc: '2.0', id: 1, error: { code: ERROR_CODES.NOT_FOUND, message: 'no session s', data: { name: 's' } } });
  await assert.rejects(answer, (error) => {
    assert.ok(error instanceof ServeError);
    assert.equal(error.code, -32007);
    assert.equal(error.detail, 'no session s');
    assert.deepEqual(error.data, { name: 's' });
    return true;
  });
});

test('an answer with neither result nor error rejects rather than resolving undefined', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.request('list_sessions', {});
  peer.deliver({ jsonrpc: '2.0', id: 1 });
  await assert.rejects(answer, /neither a result nor an error/);
});

test('a close rejects every pending request with its reason, and later sends say why', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.request('list_sessions', {});
  peer.close('no daemon is listening on 127.0.0.1:8256.', null);
  await assert.rejects(answer, /no daemon is listening/);
  await assert.rejects(client.request('list_sessions', {}), /Cannot send list_sessions: no daemon is listening/);
});

test('events are routed by method, and an answer for no request is a protocol violation', () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const events = [];
  const violations = [];
  client.on('event', (event) => events.push(event));
  client.on('protocolViolation', (detail) => violations.push(detail));
  peer.deliver({ jsonrpc: '2.0', method: 'event', params: { session_id: 's', epoch: 'e', seq: 1, kind: 'ui', data: {} } });
  peer.deliver({ jsonrpc: '2.0', id: 99, result: null });
  peer.deliver({ jsonrpc: '2.0', id: null, error: { code: ERROR_CODES.PARSE_ERROR, message: 'not JSON' } });
  peer.deliver({ jsonrpc: '2.0', method: 'mystery' });
  assert.deepEqual(events, [{ session_id: 's', epoch: 'e', seq: 1, kind: 'ui', data: {} }]);
  assert.equal(violations.length, 3);
  assert.match(violations[1], /unknown id null: -32700 not JSON/);
});
