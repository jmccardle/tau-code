/**
 * The session store: a replica, this head's cursor, and the live view of the
 * turn running on it -- against synthetic frames, with no daemon and no model.
 *
 * What is tested is THIS code's reading of the stream: which cursor's events
 * paint, how deltas fold, when the live copy gives way to the entry, what a
 * gap does. τ's own streaming is tested on τ's side.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../dist/session.js';

const SURFACE = { commands: [], command_args: {}, shortcuts: [], extensions: [], loaded: [], load_errors: [], warnings: [] };

function cursor(id, leaf, busy = false) {
  return { cursor_id: id, leaf, label: id, owner_id: null, busy, model: 'm', request: null };
}

function attached(overrides = {}) {
  return {
    session_id: 's1',
    epoch: 'e1',
    seq: 1,
    entries: [
      { type: 'message', id: 'u1', parentId: null, timestamp: 't', message: { role: 'user', content: 'hi', timestamp: 0 } },
    ],
    cursors: [cursor('head', 'u1'), cursor('other', 'u1')],
    head_cursor_id: 'head',
    cwd: '/w',
    models: [],
    surface: SURFACE,
    requests: [],
    ...overrides,
  };
}

/** A client stand-in: answers `attach` from a queue, and lets a test push events. */
function fakeClient(answers = [attached()]) {
  const handlers = new Set();
  const calls = [];
  return {
    calls,
    closed: false,
    on(name, handler) {
      if (name !== 'event') return () => {};
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async request(type, fields) {
      calls.push({ type, fields });
      if (type === 'attach') return answers.shift() ?? attached({ entries: null });
      throw new Error(`unexpected request: ${type}`);
    },
    push(seq, kind, data) {
      for (const handler of handlers) handler({ session_id: 's1', epoch: 'e1', seq, kind, data });
    },
  };
}

async function attachedStore(client = fakeClient()) {
  const store = new SessionStore('s1');
  await store.attach(client);
  return { store, client };
}

test('open by an id prefix holds the session under the full id τ answered with', async () => {
  const client = fakeClient([attached({ session_id: 's1' })]);
  const store = await SessionStore.open(client, 's');
  assert.equal(client.calls[0].fields.session_id, 's', 'τ resolves the prefix, not this client');
  assert.equal(store.sessionId, 's1');
  assert.equal(store.state.cursorId, 'head');
  // Events name the full id; a store keyed by the prefix would drop them.
  const before = store.state.revision;
  client.push(2, 'entry_final', {
    cursor_id: 'head',
    entry: { type: 'message', id: 'a1', parentId: 'u1', timestamp: 't', message: { role: 'user', content: 'again', timestamp: 0 } },
  });
  assert.notEqual(store.state.revision, before);
});

test('attach takes the head cursor and draws the path at its leaf', async () => {
  const { store } = await attachedStore();
  assert.equal(store.state.cursorId, 'head');
  assert.deepEqual(store.state.path.map((entry) => entry.id), ['u1']);
});

test('an entry event extends the path once the cursor moves onto it', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'entry_open', { entry: { type: 'message', id: 'a1', parentId: 'u1', timestamp: 't', status: 'incomplete' } });
  client.push(3, 'cursors', { cursors: [cursor('head', 'a1', true), cursor('other', 'u1')] });
  assert.deepEqual(store.state.path.map((entry) => entry.id), ['u1', 'a1']);
  assert.equal(store.state.cursor.busy, true);
});

test('text deltas fold into one block, and replace resets it', async () => {
  const { store, client } = await attachedStore();
  const delta = (seq, text, extra = {}) =>
    client.push(seq, 'agent_event', { type: 'message_update', timestamp: 0, cursor_id: 'head', delta: text, block_type: 'text', ...extra });
  delta(2, 'Hel');
  delta(3, 'lo');
  assert.deepEqual(store.state.live.blocks, [{ kind: 'text', text: 'Hello' }]);
  delta(4, 'Goodbye', { replace: true });
  assert.deepEqual(store.state.live.blocks, [{ kind: 'text', text: 'Goodbye' }], 'a replace that appended would double the text');
});

test('another cursor’s turn never paints into this one', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'agent_event', { type: 'message_update', timestamp: 0, cursor_id: 'other', delta: 'not mine', block_type: 'text' });
  assert.deepEqual(store.state.live.blocks, []);
});

test('message_end hands the text to the entry, and notes a truncation by the output cap', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'agent_event', { type: 'message_update', timestamp: 0, cursor_id: 'head', delta: 'x', block_type: 'text' });
  client.push(3, 'agent_event', { type: 'message_end', timestamp: 0, cursor_id: 'head', stop_reason: 'length', dropped_tool_calls: 2 });
  assert.deepEqual(store.state.live.blocks, []);
  assert.deepEqual(store.state.live.truncation, { droppedToolCalls: 2 });
});

test('a provider retry is a passing notice: the next message clears it', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'agent_event', {
    type: 'provider_retry', timestamp: 0, cursor_id: 'head', attempt: 1, max_retries: 3, delay_seconds: 1, error: 'HTTP 503',
  });
  assert.deepEqual(store.state.live.retry, { attempt: 1, maxRetries: 3, delaySeconds: 1, error: 'HTTP 503' });
  client.push(3, 'agent_event', { type: 'message_start', timestamp: 0, cursor_id: 'head' });
  assert.equal(store.state.live.retry, null);
});

test('a retry that ran out is cleared by agent_end, whose own error stands', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'agent_event', { type: 'provider_retry', timestamp: 0, cursor_id: 'head', attempt: 3, error: 'HTTP 503' });
  client.push(3, 'agent_event', { type: 'agent_end', timestamp: 0, cursor_id: 'head', end_reason: 'error', error: 'HTTP 503' });
  assert.equal(store.state.live.retry, null);
});

test('follow-ups an abort dropped are kept whole, until the next turn starts', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'agent_event', { type: 'follow_ups_dropped', timestamp: 0, cursor_id: 'head', dropped: ['and then this'] });
  assert.deepEqual(store.state.live.droppedFollowUps, ['and then this']);
  client.push(3, 'agent_event', { type: 'agent_start', timestamp: 0, cursor_id: 'head' });
  assert.equal(store.state.live.droppedFollowUps, null);
});

test('a running tool shows the arguments its assistant entry asked for, and leaves when it ends', async () => {
  const { store, client } = await attachedStore();
  // The event stream carries no arguments: they are in the assistant entry
  // finalized before the tool runs, on the same socket.
  client.push(2, 'entry_final', {
    cursor_id: 'head',
    entry: {
      type: 'message',
      id: 'a1',
      parentId: 'u1',
      timestamp: 't',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a.txt' } }],
        api: 'x',
        model: 'm',
        provider: 'p',
        stop_reason: 'toolUse',
      },
    },
  });
  client.push(3, 'cursors', { cursors: [cursor('head', 'a1', true), cursor('other', 'u1')] });
  client.push(4, 'agent_event', { type: 'tool_execution_start', timestamp: 5, cursor_id: 'head', tool_call_id: 't1', tool_name: 'read' });
  assert.deepEqual(store.state.live.tools.map((call) => [call.name, call.args]), [['read', { path: 'a.txt' }]]);
  client.push(5, 'agent_event', { type: 'tool_execution_end', timestamp: 6, cursor_id: 'head', tool_call_id: 't1' });
  assert.deepEqual(store.state.live.tools, []);
});

test('a cache notice is shown once per sentence, not every turn', async () => {
  const { store, client } = await attachedStore();
  const end = (seq) => client.push(seq, 'agent_event', { type: 'agent_end', timestamp: 0, cursor_id: 'head', cache_notice: 'not read' });
  end(2);
  assert.equal(store.state.live.cacheNotice, 'not read');
  client.push(3, 'agent_event', { type: 'agent_start', timestamp: 0, cursor_id: 'head' });
  end(4);
  assert.equal(store.state.live.cacheNotice, 'not read', 'still shown, from the first time');
});

test('forms open on request and close on request_closed, whoever answered', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'request', { request_id: 'f1', spec: { title: 'Name?', fields: [{ name: 'n', kind: 'text' }] } });
  assert.deepEqual(store.state.forms.map((form) => form.requestId), ['f1']);
  client.push(3, 'request_closed', { request_id: 'f1' });
  assert.deepEqual(store.state.forms, []);
});

test('forms open at attach time are drawn without waiting for an event', async () => {
  const { store } = await attachedStore(
    fakeClient([attached({ requests: [{ request_id: 'f9', spec: { fields: [] } }] })]),
  );
  assert.deepEqual(store.state.forms.map((form) => form.requestId), ['f9']);
});

test('a gap in seq re-attaches from where the replica is current', async () => {
  const { client } = await attachedStore();
  client.push(5, 'ui', { op: 'notify', level: 'info', message: 'skipped ahead' });
  await new Promise((resolve) => setImmediate(resolve));
  const reattach = client.calls.filter((call) => call.type === 'attach').at(-1);
  assert.deepEqual(reattach.fields, { session_id: 's1', epoch: 'e1', since: 1 });
});

test('a warnings event replaces the surface set and is not a display call', async () => {
  const flagged = { source: 'tau', key: 'load:broken', message: 'broken did not load', severity: 'error' };
  const { store, client } = await attachedStore(fakeClient([attached({ surface: { ...SURFACE, warnings: [flagged] } })]));
  assert.deepEqual(store.state.attached.surface.warnings, [flagged]);
  const next = { source: 'notes', key: 'stale', message: 'index is stale', severity: 'warning' };
  client.push(2, 'ui', { op: 'warnings', warnings: [next] });
  assert.deepEqual(store.state.attached.surface.warnings, [next]);
  client.push(3, 'ui', { op: 'warnings', warnings: [] });
  assert.deepEqual(store.state.attached.surface.warnings, []);
  assert.deepEqual(store.state.ui, []);
  // The rest of the surface is untouched.
  assert.equal(store.state.attached.surface.commands, SURFACE.commands);
});

test('the attachment report of a submission is kept by its id', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'channel', {
    name: 'submission_start',
    payload: {
      submission: { submission_id: 'sub-1' },
      attachments: { expanded: 1, images: 0, unresolved: ['nope'], failures: [] },
    },
  });
  assert.deepEqual(store.state.attachments, {
    submissionId: 'sub-1',
    report: { expanded: 1, images: 0, unresolved: ['nope'], failures: [] },
  });
});

test('compaction_end becomes a sentence, and a failed one says nothing changed', async () => {
  const { store, client } = await attachedStore();
  client.push(2, 'compaction_end', { compaction_id: 'k1', request_id: null, is_error: true, error: 'model unreachable', cancelled: false, leaf: 'u1' });
  assert.deepEqual(store.state.compaction, { text: 'Compaction failed: model unreachable. Nothing was changed.', failed: true });
  client.push(3, 'compaction_end', { compaction_id: 'k2', request_id: null, is_error: false, cancelled: false, performed: true, tokens_saved: 1200, leaf: 'u1' });
  assert.equal(store.state.compaction.failed, false);
  assert.match(store.state.compaction.text, /Compacted\. It saved about 1,200 tokens\./);
});
