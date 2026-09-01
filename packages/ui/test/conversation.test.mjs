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
