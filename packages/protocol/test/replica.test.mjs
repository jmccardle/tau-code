import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Replica } from '../dist/index.js';

const SURFACE = { commands: [], command_args: {}, shortcuts: [], extensions: [], loaded: [], load_errors: [] };

function attached(overrides = {}) {
  return {
    session_id: 's',
    epoch: 'e1',
    seq: 2,
    entries: [
      { id: 'a', parentId: null, type: 'message', message: { role: 'user', content: 'hi' } },
      { id: 'b', parentId: 'a', type: 'message', message: { role: 'assistant', content: [] } },
    ],
    cursors: [{ cursor_id: 'c1', leaf: 'b', label: 'head', owner_id: null, busy: false, model: 'm' }],
    head_cursor_id: 'c1',
    cwd: '/w',
    models: [],
    surface: SURFACE,
    ...overrides,
  };
}

function event(seq, kind, data, epoch = 'e1') {
  return { session_id: 's', epoch, seq, kind, data };
}

test('a snapshot replaces the replica and sets the resume point', () => {
  const replica = new Replica('s');
  replica.applyAttached(attached());
  assert.deepEqual([...replica.entries.keys()], ['a', 'b']);
  assert.deepEqual(replica.resume, { epoch: 'e1', since: 2 });
});

test('last write wins, keeping the first position', () => {
  const replica = new Replica('s');
  replica.applyAttached(attached());
  assert.equal(replica.apply(event(3, 'entry_open', { entry: { id: 'c', parentId: 'b' } })), 'applied');
  assert.equal(
    replica.apply(event(4, 'entry_final', { entry: { id: 'a', parentId: null, edited: true } })),
    'applied',
  );
  assert.deepEqual([...replica.entries.keys()], ['a', 'b', 'c']);
  assert.equal(replica.entries.get('a').edited, true);
});

test('a duplicate seq is dropped; a skipped seq or another epoch is a gap', () => {
  const replica = new Replica('s');
  replica.applyAttached(attached());
  assert.equal(replica.apply(event(2, 'ui', {})), 'duplicate');
  assert.equal(replica.apply(event(4, 'ui', {})), 'gap');
  assert.equal(replica.apply(event(3, 'ui', {}, 'e2')), 'gap');
  assert.equal(replica.apply(event(3, 'agent_event', {})), 'passed');
  assert.deepEqual(replica.resume, { epoch: 'e1', since: 3 });
});

test('cursors events replace the whole set', () => {
  const replica = new Replica('s');
  replica.applyAttached(attached());
  replica.apply(event(3, 'cursors', { cursors: [] }));
  assert.deepEqual(replica.cursors, []);
});

test('a replay answer continues the held epoch, and is refused for any other', () => {
  const replica = new Replica('s');
  replica.applyAttached(attached());
  replica.applyAttached(attached({ entries: null, seq: 2 }));
  assert.deepEqual([...replica.entries.keys()], ['a', 'b']);
  const fresh = new Replica('s');
  assert.throws(() => fresh.applyAttached(attached({ entries: null })), /can only continue the epoch/);
});

test('path walks parentId root to leaf and reports a missing parent', () => {
  const replica = new Replica('s');
  replica.applyAttached(attached());
  assert.deepEqual(
    replica.path('b').entries.map((entry) => entry.id),
    ['a', 'b'],
  );
  replica.apply(event(3, 'entry_open', { entry: { id: 'x', parentId: 'gone' } }));
  const broken = replica.path('x');
  assert.deepEqual(broken.entries.map((entry) => entry.id), ['x']);
  assert.equal(broken.missingParent, 'gone');
  assert.deepEqual(replica.path(null).entries, []);
});
