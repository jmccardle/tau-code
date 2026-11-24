import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionClosed, PROTOCOL, ServeClient, ServeError } from '../dist/index.js';
import { pair } from './helpers.mjs';

test('hello names PROTOCOL and the client id, and resolves with the Welcome', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const welcome = client.hello('me@host:test');
  assert.deepEqual(peer.sent, [
    { jsonrpc: '2.0', id: 0, method: 'hello', params: { protocol: PROTOCOL, client: 'me@host:test' } },
  ]);
  const answer = { protocol: PROTOCOL, version: '0.17.0', session: 's', cwd: '/w', pid: 1 };
  peer.deliver({ jsonrpc: '2.0', id: 0, result: answer });
  assert.deepEqual(await welcome, answer);
});

test('events go to the handler; answers match by id in any order', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const events = [];
  client.on('event', (event) => events.push(event.kind));
  const a = client.call('open', { at: 0 });
  const b = client.call('node', { id: 0 });
  peer.deliver({ jsonrpc: '2.0', method: 'event', params: { kind: 'Labels', labels: [] } });
  peer.deliver({ jsonrpc: '2.0', id: 1, result: { id: 0 } });
  peer.deliver({ jsonrpc: '2.0', id: 0, result: 3 });
  assert.equal(await a, 3);
  assert.deepEqual(await b, { id: 0 });
  assert.deepEqual(events, ['Labels']);
});

test('an error answer is a ServeError named from the schema, with τ\'s sentence', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const call = client.call('step', { cursor: 0 });
  peer.deliver({ jsonrpc: '2.0', id: 0, error: { code: -32001, message: 'cursor 0 is busy' } });
  await assert.rejects(call, (error) => {
    assert.ok(error instanceof ServeError);
    assert.equal(error.errorName, 'Busy');
    assert.ok(error.is('Busy'));
    assert.equal(error.detail, 'cursor 0 is busy');
    return true;
  });
});

test('end, then the close, rejects what is pending with the end\'s reason', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const closes = [];
  client.on('closed', (reason, end) => closes.push([reason, end]));
  const call = client.call('run', { cursor: 0, command: 'x', args: {} });
  const cut = { code: -32014, message: 'this client fell behind' };
  peer.deliver({ jsonrpc: '2.0', method: 'end', params: { error: cut } });
  peer.drop('the server ended the stream');
  await assert.rejects(call, (error) => error instanceof ConnectionClosed && /fell behind/.test(error.reason));
  assert.deepEqual(closes, [['this client fell behind (-32014)', { error: cut }]]);
  await assert.rejects(client.call('step', { cursor: 0 }), ConnectionClosed);
});

test('an end with no error reads as the server stopping', async () => {
  const peer = pair();
  const client = new ServeClient(peer.transport);
  const closes = [];
  client.on('closed', (reason) => closes.push(reason));
  peer.deliver({ jsonrpc: '2.0', method: 'end', params: { error: null } });
  peer.drop('the server ended the stream');
  assert.deepEqual(closes, ['the server stopped']);
});

for (const [name, message] of [
  ['an answer to no call', { jsonrpc: '2.0', id: 9, result: null }],
  ['an unknown notification', { jsonrpc: '2.0', method: 'panel', params: {} }],
  ['not JSON-RPC 2.0', { id: 0, result: null }],
  ['an unknown error code', { jsonrpc: '2.0', id: 0, error: { code: -1, message: 'x' } }],
]) {
  test(`${name} closes the connection as a protocol violation`, async () => {
    const peer = pair();
    const client = new ServeClient(peer.transport);
    const closes = [];
    client.on('closed', (reason) => closes.push(reason));
    const call = client.call('step', { cursor: 0 });
    peer.deliver(message);
    await assert.rejects(call);
    assert.equal(closes.length, 1);
    assert.match(closes[0], /protocol violation/);
  });
}
