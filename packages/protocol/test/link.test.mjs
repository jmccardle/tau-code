import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeError, PROTOCOL, SessionLink } from '../dist/index.js';
import { node, pair, view } from './helpers.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const WELCOME = { protocol: PROTOCOL, version: '0.17.0', session: 's1', cwd: '/w', pid: 7 };

/**
 * A scripted server behind fake transports: `hello` gets the snapshot then the Welcome, `watch`
 * null, `walk` the nodes from `tree`, `nodes` a page of `tree`. Each `open` makes a connection.
 */
function server({ snapshot = [view(0, 2), { kind: 'Labels', labels: [] }], tree = [], hello = null } = {}) {
  const connections = [];
  const calls = [];
  const control = { refuse: null, opens: 0 };
  const open = async () => {
    control.opens++;
    if (control.refuse) throw control.refuse;
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
  return { open, connections, calls, control };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FAST = { firstMs: 1, maxMs: 2 };

/** The link's state after `ms`, sampled every few ms: a final failure must not move. */
async function settle(link, ms = 60) {
  const phases = new Set();
  for (let t = 0; t < ms; t += 5) {
    phases.add(link.state.phase);
    await wait(5);
  }
  return phases;
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
  assert.deepEqual(fake.calls[0][1], { protocol: PROTOCOL, client: 'me@test:web' });
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
  const link = new SessionLink({ open: fake.open, client: 'me', retry: FAST });
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

test('a CutOff reconnects after the backoff, not in a tight loop', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: { firstMs: 40, maxMs: 40 } });
  link.start();
  await tick();
  const peer = fake.connections[0];
  peer.deliver({ jsonrpc: '2.0', method: 'end', params: { error: { code: -32014, message: 'fell behind' } } });
  peer.drop('the server ended the stream');
  assert.equal(link.state.phase, 'reconnecting');
  assert.match(link.state.detail, /cut off: fell behind/);
  await tick();
  assert.equal(fake.connections.length, 1, 'not at once');
  await wait(60);
  assert.equal(link.state.phase, 'ready');
  assert.equal(fake.connections.length, 2);
  link.dispose();
});

test('retry() while connected makes exactly one new connection and closes the old', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: FAST });
  link.start();
  await tick();
  let closed = 0;
  const old = fake.connections[0].transport;
  const close = old.close;
  old.close = () => {
    closed++;
    close();
  };
  link.retry();
  await wait(30); // well past any backoff the old connection's close could have armed
  assert.equal(link.state.phase, 'ready');
  assert.equal(closed, 1, 'the old connection is closed');
  assert.equal(fake.control.opens, 2, 'one open for start, one for retry: nothing more');
  link.dispose();
});

test('retry() while backing off connects once, now', async () => {
  const fake = server({ tree });
  fake.control.refuse = new EdgeError('unreachable', 'nothing answers');
  const link = new SessionLink({ open: fake.open, client: 'me', retry: { firstMs: 40, maxMs: 40 } });
  link.start();
  await tick();
  assert.equal(link.state.phase, 'connecting');
  assert.equal(fake.control.opens, 1);
  fake.control.refuse = null;
  link.retry();
  await tick();
  assert.equal(link.state.phase, 'ready');
  await wait(60); // the cancelled backoff timer must not open another
  assert.equal(fake.control.opens, 2);
  link.dispose();
});

test('a 401 in the middle of a session (a restarted server, a new token) is final', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: FAST });
  link.start();
  await tick();
  fake.control.refuse = new EdgeError('unauthorized', 'http://edge/ answered HTTP 401: a bearer token is required', 401);
  fake.connections[0].drop('the server ended the stream');
  await wait(40);
  assert.equal(link.state.phase, 'failed');
  assert.equal(link.state.refusal, 'unauthorized');
  const opens = fake.control.opens;
  await wait(40);
  assert.equal(fake.control.opens, opens, 'no retry after a final refusal');
  link.dispose();
});

test('a refused token or origin is final; an unreachable server is retried', async () => {
  for (const kind of ['unauthorized', 'forbidden', 'not-an-edge']) {
    const link = new SessionLink({
      open: async () => {
        throw new EdgeError(kind, `refused: ${kind}`);
      },
      client: 'me',
      retry: FAST,
    });
    link.start();
    assert.deepEqual(await settle(link), new Set(['connecting', 'failed']));
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

test('a protocol mismatch is final: it stays failed, with no reconnect', async () => {
  const fake = server({ hello: { code: -32006, message: 'this server speaks protocol 2', data: { server: 2 } } });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: FAST });
  link.start();
  await tick();
  assert.deepEqual(await settle(link), new Set(['failed']));
  assert.equal(link.state.refusal, 'protocol');
  assert.match(link.state.detail, /protocol 2/);
  assert.equal(fake.control.opens, 1);
  link.dispose();
});

test('an event kind protocol 2 does not have is final, and says which', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: FAST });
  link.start();
  await tick();
  fake.connections[0].deliver({ jsonrpc: '2.0', method: 'event', params: { kind: 'Panel' } });
  assert.deepEqual(await settle(link), new Set(['failed']));
  assert.match(link.state.detail, /unknown kind "Panel"/);
  assert.equal(fake.control.opens, 1);
  link.dispose();
});

test('a message protocol 2 does not allow is final', async () => {
  const fake = server({ tree });
  const link = new SessionLink({ open: fake.open, client: 'me', retry: FAST });
  link.start();
  await tick();
  fake.connections[0].deliver({ jsonrpc: '2.0', id: 999, result: null });
  assert.deepEqual(await settle(link), new Set(['failed']));
  assert.match(link.state.detail, /protocol violation: an answer to no call/);
  assert.equal(fake.control.opens, 1);
  link.retry();
  await tick();
  assert.equal(link.state.phase, 'ready', 'retry() after a final failure tries again');
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
