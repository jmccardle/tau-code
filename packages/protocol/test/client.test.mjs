import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServeClient, ServeError, ProtocolVersionError, PROTOCOL_VERSION } from '../dist/index.js';

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

test('a request carries its type and an id, and resolves with the result', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.request('list_sessions', {});
  assert.deepEqual(peer.sent, [{ type: 'list_sessions', id: 1 }]);
  peer.deliver({ type: 'response', id: 1, ok: true, result: [] });
  assert.deepEqual(await answer, []);
});

test('hello names the generated protocol version', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.hello('tau-code-test', null);
  assert.equal(peer.sent[0].protocol, PROTOCOL_VERSION);
  assert.equal(peer.sent[0].token, null);
  peer.deliver({ type: 'response', id: 1, ok: true, result: null });
  await answer;
});

test('a protocol_mismatch refusal is a ProtocolVersionError and closes the client', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.hello('tau-code-test', null);
  peer.deliver({
    type: 'response',
    id: 1,
    ok: false,
    error: { code: 'protocol_mismatch', message: 'this daemon speaks 9.9' },
  });
  await assert.rejects(answer, ProtocolVersionError);
  assert.equal(client.closed, true);
});

test("ok:false keeps τ's sentence verbatim as detail", async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.request('detach', { session_id: 's' });
  peer.deliver({ type: 'response', id: 1, ok: false, error: { code: 'not_found', message: 'no session s' } });
  await assert.rejects(answer, (error) => {
    assert.ok(error instanceof ServeError);
    assert.equal(error.code, 'not_found');
    assert.equal(error.detail, 'no session s');
    return true;
  });
});

test('a close rejects every pending request with its reason, and later sends say why', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const answer = client.request('list_sessions', {});
  peer.close('no daemon is listening on 127.0.0.1:8256.', null);
  await assert.rejects(answer, /no daemon is listening/);
  await assert.rejects(client.request('list_sessions', {}), /Cannot send list_sessions: no daemon is listening/);
});

test('events are routed, and a response for no request is a protocol violation', () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const events = [];
  const violations = [];
  client.on('event', (event) => events.push(event));
  client.on('protocolViolation', (detail) => violations.push(detail));
  peer.deliver({ type: 'event', session_id: 's', epoch: 'e', seq: 1, kind: 'ui', data: {} });
  peer.deliver({ type: 'response', id: 99, ok: true, result: null });
  peer.deliver({ type: 'mystery' });
  assert.equal(events.length, 1);
  assert.equal(violations.length, 2);
});
