import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeError, SessionLink } from '../dist/index.js';
import { node, pair, view } from './helpers.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const WELCOME = { protocol: 1, version: '0.16.1', session: 's1', cwd: '/w', pid: 7 };

/**
 * A scripted server behind fake transports: `hello` gets the snapshot then the Welcome, `watch`
 * null, `walk` the nodes from `tree`, `nodes` a page of `tree`. Each `open` makes a connection.
 */
function server({ snapshot = [view(0, 2), { kind: 'Labels', labels: [] }], tree = [], hello = null } = {}) {
  const connections = [];
  const calls = [];
  const open = async () => {
    const peer = pair();
    connections.push(peer);
    const { transport } = peer;
    const send = transport.send;
    transport.send = (message) => {
      send(message);
      calls.push([message.method, message.params]);
      const answer = (result) => peer.deliver({ jsonrpc: '2.0', id: message.id, result });
      queueMicrotask(() => {
        switch (message.method) {
          case 'hello':
            if (hello) return peer.deliver({ jsonrpc: '2.0', id: message.id, error: hello });
            for (const event of snapshot) peer.deliver({ jsonrpc: '2.0', method: 'event', params: event });
            return answer(WELCOME);
          case 'walk': {
            const byId = new Map(tree.map((n) => [n.id, n]));
            const chain = [];
            for (let id = message.params.id; id !== null && id !== undefined; id = byId.get(id)?.parent) {
              chain.unshift(byId.get(id));
            }
            return answer(chain);
          }
          case 'nodes':
            return answer(tree.slice(message.params.start, message.params.start + message.params.limit));
          default:
            return answer(null);
        }
      });
    };
    return transport;
  };
  return { open, connections, calls };
}

const tree = [node(0, null, { System: 's' }, 'Core'), node(1, 0), node(2, 1)];

test('ready after hello: the snapshot is in the model, the first open cursor followed', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me@test:web' });
  link.start();
  await tick();
  assert.equal(link.state.phase, 'ready');
  assert.deepEqual(link.state.welcome, WELCOME);
  assert.equal(link.state.focus, 0);
  assert.deepEqual(fake.calls.map(([m]) => m), ['hello', 'watch', 'walk']);
  assert.deepEqual(fake.calls[0][1], { protocol: 1, client: 'me@test:web' });
  assert.deepEqual(fake.calls[1][1], { cursors: [0] });
  assert.deepEqual(link.state.model.walk(2).map((n) => n.id), [0, 1, 2]);
  link.dispose();
});

test('focus moves the watch; a closed followed cursor moves to the lowest open one', async () => {
  const fake = server({ tree, snapshot: [view(0, 2), view(3, 2), { kind: 'Labels', labels: [] }] });
  const link = new SessionLink({ open: fake.open, client: 'me' });
  link.start();
  await tick();
  link.focus(3);
  await tick();
  assert.deepEqual(fake.calls.filter(([m]) => m === 'watch').at(-1)[1], { cursors: [3] });
  fake.connections[0].deliver({ jsonrpc: '2.0', method: 'event', params: { kind: 'CursorGone', cursor: 3, at: 2 } });
  await tick();
  assert.equal(link.state.focus, 0);
  assert.match(link.state.model.notices.at(-1).text, /cursor 3 was closed; showing cursor 0/);
  link.dispose();
});

test('a dropped connection reconnects into a fresh model; calls in between are refused', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: { firstMs: 1, maxMs: 1 } });
  link.start();
  await tick();
  const first = link.state.model;
  fake.connections[0].drop('the stream broke: reset');
  assert.equal(link.state.phase, 'reconnecting');
  assert.equal(link.state.detail, 'the stream broke: reset');
  await assert.rejects(link.call('step', { cursor: 0 }), /the connection closed/);
  await tick();
  assert.equal(link.state.phase, 'ready');
  assert.notEqual(link.state.model, first, 'no resume: a new model from a new snapshot');
  assert.equal(fake.connections.length, 2);
  link.dispose();
});

test('a CutOff reconnects at once', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: { firstMs: 60_000, maxMs: 60_000 } });
  link.start();
  await tick();
  const peer = fake.connections[0];
  peer.deliver({ jsonrpc: '2.0', method: 'end', params: { error: { code: -32014, message: 'fell behind' } } });
  peer.drop('the server ended the stream');
  await tick();
  assert.equal(link.state.phase, 'ready', 'no backoff wait for a cut-off');
  assert.equal(fake.connections.length, 2);
  link.dispose();
});

test('a refused token or origin is final; an unreachable server is retried', async () => {
  for (const kind of ['unauthorized', 'forbidden', 'not-an-edge']) {
    const link = new SessionLink({
      open: async () => {
        throw new EdgeError(kind, `refused: ${kind}`);
      },
      client: 'me',
    });
    link.start();
    await tick();
    assert.equal(link.state.phase, 'failed');
    assert.equal(link.state.refusal, kind);
    link.dispose();
  }
  let tries = 0;
  const link = new SessionLink({
    open: async () => {
      tries++;
      throw new EdgeError('unreachable', 'nothing answers');
    },
    client: 'me',
    retry: { firstMs: 1, maxMs: 2 },
  });
  link.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(link.state.phase, 'connecting');
  assert.equal(link.state.detail, 'nothing answers');
  assert.ok(tries > 2);
  link.dispose();
});

test('a protocol mismatch is final and says to use a matching tau-code', async () => {
  const fake = server({ hello: { code: -32006, message: 'this server speaks protocol 2', data: { server: 2 } } });
  const link = new SessionLink({ open: fake.open, client: 'me' });
  link.start();
  await tick();
  assert.equal(link.state.phase, 'failed');
  assert.equal(link.state.refusal, 'protocol');
  assert.match(link.state.detail, /protocol 2/);
  link.dispose();
});

test('loadTree reads every page, then is whole', async () => {
  const many = [node(0, null, { System: 's' }, 'Core')];
  for (let id = 1; id < 1203; id++) many.push(node(id, id - 1));
  const fake = server({ tree: many, snapshot: [view(0, 0), { kind: 'Labels', labels: [] }] });
  const link = new SessionLink({ open: fake.open, client: 'me' });
  link.start();
  await tick();
  await link.loadTree();
  assert.equal(link.state.treeLoaded, true);
  assert.equal(link.state.model.nodes.size, 1203);
  assert.deepEqual(
    fake.calls.filter(([m]) => m === 'nodes').map(([, p]) => p.start),
    [0, 500, 1000],
  );
  link.dispose();
});
