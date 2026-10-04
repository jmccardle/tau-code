/**
 * What a failed turn leaves in the transcript (tau docs/TURN-FAILURES.md).
 *
 * The fixtures are the entries tau 13798b4 writes: a stream cut partway, a tool
 * that raised something other than `ToolError`, and the `turn_error` message
 * every turn that raised ends with.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemOf } from '../dist/messages.js';

const at = { parentId: null, timestamp: '2026-10-03T12:00:00Z' };

test('a turn_error message is drawn as the failure, not as an extension message', () => {
  const item = itemOf({
    ...at,
    type: 'customMessage',
    id: 'e3',
    message: {
      role: 'custom',
      customType: 'turn_error',
      display: true,
      visibleToModel: false,
      content: [{ type: 'text', text: 'The turn failed: RuntimeError: overloaded' }],
      details: { exception: "RuntimeError('overloaded')" },
    },
  });
  assert.equal(item.kind, 'turnError');
  assert.deepEqual(item.blocks, [{ type: 'text', text: 'The turn failed: RuntimeError: overloaded' }]);
});

test('a stream cut partway keeps its text and says it was cut', () => {
  const item = itemOf({
    ...at,
    type: 'message',
    id: 'e2',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Half an ans' }],
      stop_reason: 'error',
      error_message: 'overloaded',
    },
  });
  assert.equal(item.kind, 'assistant');
  assert.equal(item.stopReason, 'error');
  assert.equal(item.error, 'overloaded');
  assert.deepEqual(item.blocks, [{ type: 'text', text: 'Half an ans' }]);
});

test("a tool's internal exception is shown apart from what the model read", () => {
  const item = itemOf({
    ...at,
    type: 'message',
    id: 'e4',
    message: {
      role: 'toolResult',
      tool_call_id: 'c1',
      tool_name: 'read',
      content: [{ type: 'text', text: 'The tool failed with an internal error.' }],
      is_error: true,
      details: { exception: "KeyError('path')", elapsed: 3 },
    },
  });
  assert.equal(item.exception, "KeyError('path')");
  assert.deepEqual(item.details, { elapsed: 3 });
});

test('a tool result whose details are only the exception has no other details', () => {
  const item = itemOf({
    ...at,
    type: 'message',
    id: 'e5',
    message: {
      role: 'toolResult',
      tool_call_id: 'c2',
      tool_name: 'read',
      content: [{ type: 'text', text: 'The tool failed with an internal error.' }],
      is_error: true,
      details: { exception: "KeyError('path')" },
    },
  });
  assert.equal(item.details, null);
});
