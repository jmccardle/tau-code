/**
 * Reading the flow loop, and the extension request.
 *
 * Both are shapes tau sends and this client narrows. What is tested here is the
 * NARROWING -- check-then-throw, naming the field -- because that is the whole of
 * what this side owns. tau's own vocabulary (which argument comes next, what a
 * domain holds, whether an ask's values validate) is tested on tau's side, and
 * asserting it here would pin it in two places and let them disagree.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateDomain, offersPicker, readyOf, stepOf } from '../dist/flows.js';
import { answerRequest, initialValues, loadPendingRequest, refusalReason } from '../dist/requests.js';

/* ------------------------------------------------------------------ flows */

const STEP = {
  flow: 'model',
  argument: {
    name: 'name',
    domain: 'model_name',
    description: 'Which configured model.',
    cardinality: 'one',
    required: true,
    scope: null,
  },
  domain: {
    name: 'model_name',
    description: 'A model configuration name from the running config.',
    free: false,
    values: null,
    enumerator: 'get_models',
    field_kind: 'select',
  },
  cursor: null,
  bound: {},
};

test('a step is read into a field a renderer can draw with no second call', () => {
  const step = stepOf(STEP);
  assert.equal(step.flow, 'model');
  assert.equal(step.argument.name, 'name');
  assert.equal(step.argument.required, true);
  assert.equal(step.domain.enumerator, 'get_models');
  assert.equal(step.domain.fieldKind, 'select');
});

test('a field kind this head cannot draw throws, rather than rendering nothing', () => {
  // Fail Early. A silently skipped field is a form that cannot be submitted and
  // does not say why.
  assert.throws(
    () => stepOf({ ...STEP, domain: { ...STEP.domain, field_kind: 'colour-wheel' } }),
    /cannot render/,
  );
});

test('a malformed step names the missing field', () => {
  assert.throws(() => stepOf({ ...STEP, argument: { domain: 'x' } }), /argument\.name is not a string/);
  assert.throws(() => stepOf(null), /step is not an object/);
});

test('a ready names the mutation and what to perform it with', () => {
  const ready = readyOf({ flow: 'model', mutation: 'set_model', arguments: { name: 'haiku' } });
  assert.deepEqual(ready, { flow: 'model', mutation: 'set_model', arguments: { name: 'haiku' } });
});

test('a picker is offered wherever a domain has a list, whatever the declared kind', () => {
  // The richer-not-poorer rule. `session_id` and `message_id` both declare
  // `text` and both have an enumerator: a text box would make the reader type an
  // id they can only have got from a list they were never shown.
  assert.equal(offersPicker({ fieldKind: 'select', free: false, enumerator: 'get_models' }), true);
  assert.equal(offersPicker({ fieldKind: 'text', free: false, enumerator: 'list_sessions' }), true);
  assert.equal(offersPicker({ fieldKind: 'text', free: true, enumerator: null }), false);
});

test('enumerate_domain reports total, so a capped list can say it is capped', async () => {
  const client = {
    calls: [],
    async call(method, params) {
      this.calls.push({ method, params });
      return { domain: 'message_id', values: [{ value: 'a1', label: 'hello' }], total: 340 };
    },
  };
  const listing = await enumerateDomain(client, 'message_id', { cursor: 'c1' });
  assert.deepEqual(listing.values, [{ value: 'a1', label: 'hello' }]);
  assert.equal(listing.total, 340);
  assert.deepEqual(client.calls[0].params, { domain: 'message_id', cursor: 'c1' });
});

test('a value with no label falls back to the value, never to undefined', () => {
  const client = {
    async call() {
      return { values: [{ value: 'plain' }], total: 1 };
    },
  };
  return enumerateDomain(client, 'text').then((listing) => {
    assert.deepEqual(listing.values, [{ value: 'plain', label: 'plain' }]);
  });
});

/* --------------------------------------------------------------- requests */

const ASK = {
  title: 'Approve the deploy?',
  body: { text: 'It touches production.' },
  fields: [
    { name: 'ticket', kind: 'text', label: 'Change ticket' },
    { name: 'urgent', kind: 'confirm', label: 'Urgent' },
    { name: 'env', kind: 'select', label: 'Environment', options: ['staging', 'prod'] },
  ],
  actions: [
    { label: 'Approve', command: 'gate-approve' },
    { label: 'Reject', command: 'gate-reject' },
  ],
};

function requestClient(request) {
  return {
    calls: [],
    async call(method, params) {
      this.calls.push({ method, params });
      return method === 'get_pending_request' ? { request } : { handled: true, output: 'ok', cursor: 'x' };
    },
  };
}

test('no request is null, which is the ordinary answer and not a failure', async () => {
  assert.equal(await loadPendingRequest(requestClient(null)), null);
});

test('a request carries tau own framing line rather than one derived here', async () => {
  // Four states over two keys, and the sentence for each is a table tau owns.
  // Deriving it here would be a second copy of it.
  const found = await loadPendingRequest(
    requestClient({
      entry_id: 'r1',
      extension: '/x/gate.py',
      extension_name: 'gate',
      sentence: 'A deploy needs sign-off.',
      label: 'Extension gate requires a response',
      lock: true,
      ask: ASK,
      release: 'gate-clear',
    }),
  );
  assert.equal(found.label, 'Extension gate requires a response');
  assert.equal(found.lock, true);
  assert.equal(found.ask.fields.length, 3);
  assert.deepEqual(found.ask.actions[0], { label: 'Approve', command: 'gate-approve' });
});

test('an ask with no action is refused, because tau cannot build one', async () => {
  await assert.rejects(
    () =>
      loadPendingRequest(
        requestClient({
          entry_id: 'r1',
          extension: '/x/g.py',
          extension_name: 'g',
          sentence: 's',
          label: 'l',
          lock: false,
          ask: { title: 'x', fields: [], actions: [] },
          release: null,
        }),
      ),
    /declares no actions/,
  );
});

test('a field kind this head cannot draw throws before the panel is built', async () => {
  await assert.rejects(
    () =>
      loadPendingRequest(
        requestClient({
          entry_id: 'r1',
          extension: '/x/g.py',
          extension_name: 'g',
          sentence: 's',
          label: 'l',
          lock: true,
          ask: { title: 'x', fields: [{ name: 'a', kind: 'runes' }], actions: [{ label: 'Y', command: 'y' }] },
          release: null,
        }),
      ),
    /cannot render/,
  );
});

test('a bare lock says every way out, including the two that are not commands', () => {
  // A head that printed only the release command would leave a reader stuck at a
  // prompt that refuses everything, when branching past it also clears it.
  const reason = refusalReason({
    extensionName: 'gate',
    sentence: 'A deploy needs sign-off.',
    release: 'gate-clear',
  });
  assert.match(reason, /gate has stopped this session/);
  assert.match(reason, /\/gate-clear/);
  assert.match(reason, /branch past it/);

  const noRelease = refusalReason({ extensionName: 'gate', sentence: 's', release: null });
  assert.match(noRelease, /declared no command to clear it/);
});

test('a field starts at its declared default, else the empty value of its kind', () => {
  // An empty answer is the field's VALUE, not a cancellation: a form with one
  // optional-in-practice box has to be submittable.
  assert.deepEqual(initialValues(ASK), { ticket: '', urgent: false, env: 'staging' });
  assert.deepEqual(
    initialValues({ ...ASK, fields: [{ name: 'n', kind: 'number', label: 'N', default: 7 }] }),
    { n: 7 },
  );
  assert.deepEqual(
    initialValues({ ...ASK, fields: [{ name: 'm', kind: 'multiselect', label: 'M' }] }),
    { m: [] },
  );
});

test('answering sends the action LABEL, which is what the ask table is keyed by', async () => {
  const client = requestClient(null);
  const result = await answerRequest(
    client,
    { entryId: 'r1' },
    'Approve',
    { ticket: 'OPS-1' },
  );
  assert.deepEqual(client.calls[0], {
    method: 'answer_request',
    params: { request_id: 'r1', action: 'Approve', values: { ticket: 'OPS-1' } },
  });
  assert.deepEqual(result, { handled: true, output: 'ok' });
});
