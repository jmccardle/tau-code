/**
 * Tests for the conversation store, against synthetic events.
 *
 * These need no model and no network. What is being tested is THIS code's
 * reading of the event stream -- delta accumulation, the `replace` flag, tool
 * status, and the pull at turn end. tau's own streaming is tested on tau's
 * side; duplicating it here would test the wrong thing and cost API credits.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../dist/conversation.js';

/** A TauClient stand-in: records calls, lets a test push events. */
function fakeClient(messages = []) {
  const handlers = { event: [], close: [], protocolViolation: [], compactionEnd: [] };
  return {
    calls: [],
    on(name, handler) {
      handlers[name].push(handler);
      return () => {
        handlers[name] = handlers[name].filter((h) => h !== handler);
      };
    },
    async call(method, params) {
      this.calls.push({ method, params });
      if (method === 'get_messages') return { messages };
      throw new Error(`unexpected call: ${method}`);
    },
    emit(event) {
      for (const handler of handlers.event) handler(event);
    },
  };
}

const base = { timestamp: 0, is_error: false, blocked: false };

test('text deltas accumulate into one block', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'message_update', block_type: 'text', delta: 'Hel' });
  client.emit({ ...base, type: 'message_update', block_type: 'text', delta: 'lo' });
  assert.deepEqual(conv.state.live, [{ kind: 'text', text: 'Hello' }]);
});

test('replace resets the accumulator instead of appending', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'message_update', block_type: 'text', delta: 'draft' });
  client.emit({ ...base, type: 'message_update', block_type: 'text', delta: 'final', replace: true });
  // Appending here would render "draftfinal" -- the doubling bug that reads
  // like a model fault rather than a client one.
  assert.deepEqual(conv.state.live, [{ kind: 'text', text: 'final' }]);
});

test('thinking and text become separate blocks in arrival order', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'message_update', block_type: 'thinking', delta: 'hmm' });
  client.emit({ ...base, type: 'message_update', block_type: 'text', delta: 'answer' });
  client.emit({ ...base, type: 'message_update', block_type: 'thinking', delta: 'more' });
  assert.deepEqual(conv.state.live, [
    { kind: 'thinking', text: 'hmm' },
    { kind: 'text', text: 'answer' },
    { kind: 'thinking', text: 'more' },
  ]);
});

test('a tool call goes running then done', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'tool_execution_start', tool_call_id: 't1', tool_name: 'read' });
  assert.equal(conv.state.liveTools[0].status, 'running');
  assert.equal(conv.state.liveTools[0].name, 'read');
  client.emit({ ...base, type: 'tool_execution_end', tool_call_id: 't1', tool_name: 'read' });
  assert.equal(conv.state.liveTools[0].status, 'done');
});

test('an extension veto is distinct from a failed tool', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'tool_execution_start', tool_call_id: 't1', tool_name: 'bash' });
  client.emit({
    ...base,
    type: 'tool_execution_end',
    tool_call_id: 't1',
    tool_name: 'bash',
    is_error: true,
    blocked: true,
    blocked_by: 'guard',
  });
  assert.equal(conv.state.liveTools[0].status, 'blocked');
  assert.equal(conv.state.liveTools[0].blockedBy, 'guard');
});

test('agent_end pulls messages and clears the live buffer', async () => {
  const client = fakeClient([{ role: 'user', content: 'hi', timestamp: 1 }]);
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'message_update', block_type: 'text', delta: 'streamed' });
  client.emit({ ...base, type: 'agent_end', end_reason: 'done', cursor: 'c1', message_count: 1 });

  await new Promise((r) => setTimeout(r, 0));

  assert.equal(conv.state.running, false);
  assert.equal(conv.state.cursor, 'c1');
  assert.deepEqual(conv.state.live, [], 'the live buffer is replaced by the pull, not kept alongside it');
  assert.equal(conv.state.messages.length, 1);
  assert.ok(client.calls.some((c) => c.method === 'get_messages'));
});

test('a truncated run reports why', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'agent_end', end_reason: 'max_turns' });
  // 'done' and 'max_turns' produce identical transcripts; only this field says
  // the answer is cut short rather than finished.
  assert.equal(conv.state.endReason, 'max_turns');
});

test('a loop error is carried, not swallowed', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({
    ...base,
    type: 'agent_end',
    end_reason: 'error',
    is_error: true,
    error: 'RuntimeError: Connection refused',
  });
  assert.equal(conv.state.error, 'RuntimeError: Connection refused');
});

test('a new run clears the previous run end state', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'agent_end', end_reason: 'max_turns' });
  client.emit({ ...base, type: 'agent_start' });
  assert.equal(conv.state.endReason, null);
  assert.equal(conv.state.error, null);
});

/* ------------------------------------------------- the notices tau computes */

test('a completion cut off by the output cap is reported, and an abort is not', async () => {
  // The transcript cannot tell a truncated answer from a finished one, so a
  // head that showed neither turns a visible failure into a silent one. But
  // this notice tells an operator to raise a cap, and an Escape is not a cap.
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_start' });
  client.emit({ ...base, type: 'message_end', stop_reason: 'length', dropped_tool_calls: 2 });
  assert.deepEqual(conv.state.truncation, { droppedToolCalls: 2 });

  client.emit({ ...base, type: 'agent_start' });
  assert.equal(conv.state.truncation, null, 'a new run clears it');
  client.emit({ ...base, type: 'message_end', stop_reason: 'aborted', dropped_tool_calls: 3 });
  assert.equal(conv.state.truncation, null);
  client.emit({ ...base, type: 'message_end', stop_reason: 'stop' });
  assert.equal(conv.state.truncation, null);
});

test('null dropped_tool_calls stays null, because none lost is not not-reported', () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'message_end', stop_reason: 'length' });
  assert.deepEqual(conv.state.truncation, { droppedToolCalls: null });
});

test('a cache notice is shown once, not every turn', async () => {
  // The condition persists -- a gateway dropping cache_control drops it on every
  // request -- so tau sends the sentence every turn. Showing it every turn
  // teaches the reader to stop reading it.
  const client = fakeClient();
  const conv = new Conversation(client);
  const notice = 'This turn read 0 cached tokens; the gateway may be dropping cache_control.';

  client.emit({ ...base, type: 'agent_end', cache_notice: notice });
  await new Promise((r) => setImmediate(r));
  assert.equal(conv.state.cacheNotice, notice);

  client.emit({ ...base, type: 'agent_end', cache_notice: notice });
  await new Promise((r) => setImmediate(r));
  assert.equal(conv.state.cacheNotice, notice, 'still the same one, not a second');

  const other = 'A different model, a different sentence.';
  client.emit({ ...base, type: 'agent_end', cache_notice: other });
  await new Promise((r) => setImmediate(r));
  assert.equal(conv.state.cacheNotice, other, 'a new sentence is a new finding');
});

test('no cache notice is the normal case and sets nothing', async () => {
  const client = fakeClient();
  const conv = new Conversation(client);
  client.emit({ ...base, type: 'agent_end' });
  await new Promise((r) => setImmediate(r));
  assert.equal(conv.state.cacheNotice, null);
});

/* ------------------------------------------------------------ describe() */

import { describe as describeError } from '../dist/useTau.js';
import { TauRpcError } from '../../protocol/dist/index.js';

test('tau own refusal sentence is passed through, not replaced by a guess', () => {
  // This is a fix for a real defect. -32000 was answered with "a turn is
  // already running", which is ONE of its causes -- an extension lock is
  // another, and tau sends refusal_reason as the message. The guess told the
  // reader to wait for a turn that was not running, about a lock they were
  // never shown.
  const lock = new TauRpcError('submit', {
    code: -32000,
    message: 'gate has stopped this session: a deploy needs sign-off. Run /gate-clear to clear it.',
    data: { lock: { extension: '/x/gate.py' } },
  });
  assert.match(describeError(lock), /gate has stopped this session/);
  assert.doesNotMatch(describeError(lock), /turn is already running/);

  const busy = new TauRpcError('submit', {
    code: -32000,
    message: 'a turn is already running',
  });
  assert.equal(describeError(busy), 'a turn is already running');
});

test('a missing method is the one case this ADDS a sentence, because tau sends none', () => {
  const missing = new TauRpcError('get_tree', { code: -32601, message: 'Method not found' });
  assert.match(describeError(missing), /get_tree/);
  assert.match(describeError(missing), /older than the verb/);
});

test('a plain error keeps its message', () => {
  assert.equal(describeError(new Error('socket hung up')), 'socket hung up');
  assert.equal(describeError('a string'), 'a string');
});
