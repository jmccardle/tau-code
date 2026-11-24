import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTICES_KEPT, ProtocolViolation, SessionModel } from '../dist/index.js';
import { live, node, view } from './helpers.mjs';

test('the snapshot builds the views, the closed cursors and the labels', () => {
  const model = new SessionModel();
  model.hear(view(0, 3));
  model.hear({ kind: 'CursorGone', cursor: 1, at: 5 });
  model.hear(view(2, 7, { busy: true }));
  model.hear({ kind: 'Labels', labels: [['main', 0], ['side', 2], ['old', 1]] });
  assert.deepEqual(model.openCursors().map((v) => v.cursor), [0, 2]);
  assert.deepEqual([...model.gone], [[1, 5]]);
  assert.deepEqual(model.labelsOf(2), ['side']);
  assert.deepEqual(model.labelsOf(1), ['old'], 'a closed cursor keeps its labels: its restart record');
});

test('a CursorView replaces the last whole, and reopening clears the closed entry', () => {
  const model = new SessionModel();
  model.hear({ kind: 'CursorGone', cursor: 0, at: 1 });
  model.hear(view(0, 1, { auto: true }));
  model.hear(view(0, 2));
  assert.equal(model.views.get(0).at, 2);
  assert.equal(model.views.get(0).auto, false);
  assert.equal(model.gone.has(0), false);
});

test('walk is whole only when every node to the root is held; reads fill it in any order', () => {
  const model = new SessionModel();
  model.hear({ kind: 'Appended', nodes: [node(3, 2)] });
  assert.equal(model.walk(3), null);
  model.insert([node(2, 1), node(0, null, { System: 'sys' }), node(1, 0)]);
  assert.deepEqual(model.walk(3).map((n) => n.id), [0, 1, 2, 3]);
  model.insert([node(5, 1), node(4, 1)]);
  assert.deepEqual(model.childrenOf(1), [2, 4, 5], 'children in id order, whatever the read order');
  assert.deepEqual(model.roots().map((n) => n.id), [0]);
});

test('Live builds a layer per cursor; it goes when the cursor rests or moves on', () => {
  const model = new SessionModel();
  model.hear(view(0, 2, { busy: true }));
  model.hear(live(0, { kind: 'ThinkingDelta', text: 'hmm' }));
  model.hear(live(0, { kind: 'TextDelta', text: 'mock: ' }));
  model.hear(live(0, { kind: 'TextDelta', text: 'hi' }));
  model.hear(live(0, { kind: 'CallNamed', index: 0, id: 'c0', tool: 'bash' }));
  model.hear(live(0, { kind: 'CallArgs', index: 0, text: '{"cmd":' }));
  model.hear(live(0, { kind: 'CallArgs', index: 0, text: '"ls"}' }));
  model.hear(live(0, { kind: 'CallArgs', index: 9, text: 'never named' }));
  const layer = model.layers.get(0);
  assert.equal(layer.at, 2);
  assert.equal(layer.text, 'mock: hi');
  assert.equal(layer.thinking, 'hmm');
  assert.deepEqual(layer.calls, [{ index: 0, id: 'c0', tool: 'bash', args: '{"cmd":"ls"}' }]);

  model.hear(view(0, 2, { busy: true, items: [] }));
  assert.ok(model.layers.has(0), 'still on node 2 and busy: the layer stays');
  model.hear({ kind: 'Appended', nodes: [node(3, 2, { Assistant: { parts: [{ Text: 'mock: hi' }], stop: 'End' } }, 'Provider')] });
  model.hear(view(0, 3, { busy: true }));
  assert.equal(model.layers.has(0), false, 'the cursor moved to the reply: the tree holds it');

  model.hear(live(0, { kind: 'TextDelta', text: 'x' }));
  model.hear(view(0, 3, { busy: false, ending: 'Done' }));
  assert.equal(model.layers.has(0), false, 'at rest: no layer');
});

test('Retrying shows until the next delta; tool progress goes when its Results land', () => {
  const model = new SessionModel();
  model.hear(view(0, 4, { busy: true }));
  const retry = { kind: 'Retrying', attempt: 1, attempts: 3, seconds: 2, reason: '503' };
  model.hear(live(0, retry));
  assert.deepEqual(model.layers.get(0).retrying, retry);
  model.hear(live(0, { kind: 'ToolProgress', node: 4, call_id: 'c0', text: 'a' }));
  assert.deepEqual(model.layers.get(0).retrying, retry, 'progress does not end the wait');
  model.hear(live(0, { kind: 'ToolProgress', node: 4, call_id: 'c0', text: 'b' }));
  assert.deepEqual(model.layers.get(0).progress, [{ node: 4, callId: 'c0', text: 'ab' }]);
  model.hear(live(0, { kind: 'TextDelta', text: 't' }));
  assert.equal(model.layers.get(0).retrying, null);
  model.hear({ kind: 'Appended', nodes: [node(5, 4, { Results: [['c0', { Ok: 'ab' }, 'Tools']] }, 'Tools')] });
  assert.deepEqual(model.layers.get(0).progress, []);
});

test('CursorGone drops the view and the layer, and keeps where it ended', () => {
  const model = new SessionModel();
  model.hear(view(1, 4, { busy: true }));
  model.hear(live(1, { kind: 'TextDelta', text: 'x' }));
  model.hear({ kind: 'CursorGone', cursor: 1, at: 4 });
  assert.equal(model.views.has(1), false);
  assert.equal(model.layers.has(1), false);
  assert.equal(model.gone.get(1), 4);
});

test('notices are numbered, dismissable and bounded; every change bumps version', () => {
  const model = new SessionModel();
  let heard = 0;
  model.subscribe(() => heard++);
  for (let i = 0; i < NOTICES_KEPT + 5; i++) model.hear({ kind: 'Notice', text: `n${i}` });
  assert.equal(model.notices.length, NOTICES_KEPT);
  assert.equal(model.notices[0].text, 'n5');
  model.dismiss(model.notices[0].id);
  assert.equal(model.notices[0].text, 'n6');
  assert.equal(heard, NOTICES_KEPT + 6);
  assert.equal(model.version, heard);
});

test('an event kind protocol 2 does not have is a protocol violation', () => {
  const model = new SessionModel();
  assert.throws(() => model.hear({ kind: 'Panel' }), ProtocolViolation);
  assert.throws(() => model.hear(live(0, { kind: 'Sparkle' })), ProtocolViolation);
});
