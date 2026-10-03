/**
 * The flow loop's step, and the extension request.
 *
 * Both shapes are generated from τ's schema now, so what this side owns is
 * smaller than it was: reading a step into the field a renderer draws (and
 * refusing a field kind it cannot draw), carrying the request at a cursor into
 * this head's casing, and what each sends back. τ's own vocabulary (which
 * argument comes next, what a domain holds, whether an ask's values validate)
 * is tested on τ's side, and asserting it here would pin it in two places.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateDomain, offersPicker, stepOf } from '../dist/flows.js';
import { answerRequest, initialValues, refusalReason, requestOf } from '../dist/requests.js';

function fakeSession(answer) {
  const calls = [];
  const client = {
    async request(type, fields) {
      calls.push({ type, fields });
      return answer(type, fields);
    },
  };
  return { calls, session: { at: () => ({ client, session_id: 's1', cursor_id: 'c1' }) } };
}

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
  leaf: 'e7',
  bound: {},
};

test('a step is read into a field a renderer can draw with no second call', () => {
  const step = stepOf(STEP);
  assert.equal(step.flow, 'model');
  assert.equal(step.argument.name, 'name');
  assert.equal(step.argument.required, true);
  assert.equal(step.domain.enumerator, 'get_models');
  assert.equal(step.domain.fieldKind, 'select');
  assert.equal(step.leaf, 'e7');
});

test('a field kind this head cannot draw throws, rather than rendering nothing', () => {
  // Fail Early. A silently skipped field is a form that cannot be submitted and
  // does not say why.
  assert.throws(() => stepOf({ ...STEP, domain: { ...STEP.domain, field_kind: 'colour-wheel' } }), /cannot render/);
});

test('a step missing what the schema leaves optional is refused by name, not guessed at', () => {
  const { field_kind: _kind, ...noKind } = STEP.domain;
  assert.throws(() => stepOf({ ...STEP, domain: noKind }), /field_kind undefined/);
  const { required: _required, ...noRequired } = STEP.argument;
  assert.throws(() => stepOf({ ...STEP, argument: noRequired }), /required/);
});

test('a picker is offered wherever a domain has a list, whatever the declared kind', () => {
  // The richer-not-poorer rule. `session_id` and `message_id` both declare
  // `text` and both have an enumerator: a text box would make the reader type an
  // id they can only have got from a list they were never shown.
  assert.equal(offersPicker({ fieldKind: 'select', free: false, enumerator: 'get_models' }), true);
  assert.equal(offersPicker({ fieldKind: 'text', free: false, enumerator: 'list_sessions' }), true);
  assert.equal(offersPicker({ fieldKind: 'text', free: true, enumerator: null }), false);
});

test('enumerate_domain is asked at the step leaf, and reports total so a capped list can say so', async () => {
  const { session, calls } = fakeSession(() => ({
    domain: 'message_id',
    values: [{ value: 'a', label: 'A' }],
    total: 40,
  }));
  const listing = await enumerateDomain(session, 'message_id', { leaf: 'e7' });
  assert.equal(listing.total, 40);
  assert.deepEqual(listing.values, [{ value: 'a', label: 'A' }]);
  assert.deepEqual(calls[0], {
    type: 'enumerate_domain',
    fields: { session_id: 's1', cursor_id: 'c1', domain: 'message_id', leaf: 'e7' },
  });
});

/* --------------------------------------------------------------- requests */

const ASK = {
  title: 'Approve the deploy?',
  body: { kind: 'text', text: 'It touches production.' },
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

test('the request at a cursor keeps τ’s own framing line rather than one derived here', () => {
  const request = requestOf({
    entry_id: 'r1',
    extension: '/ext/gate.py',
    extension_name: 'gate',
    sentence: 'A deploy needs sign-off.',
    label: 'locked · asks',
    lock: true,
    ask: ASK,
    release: 'gate-clear',
  });
  assert.equal(request.entryId, 'r1');
  assert.equal(request.label, 'locked · asks');
  assert.equal(request.ask, ASK);
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
  assert.deepEqual(initialValues({ fields: [{ name: 'n', kind: 'number', label: 'N', default: 7 }] }), { n: 7 });
  assert.deepEqual(initialValues({ fields: [{ name: 'm', kind: 'multiselect', label: 'M' }] }), { m: [] });
});

test('answering sends the action LABEL, at this head’s cursor', async () => {
  const { session, calls } = fakeSession(() => ({ handled: true, output: 'ok' }));
  const result = await answerRequest(session, { entryId: 'r1' }, 'Approve', { ticket: 'OPS-1' });
  assert.deepEqual(calls[0], {
    type: 'answer_request',
    fields: { session_id: 's1', cursor_id: 'c1', request_id: 'r1', action: 'Approve', values: { ticket: 'OPS-1' } },
  });
  assert.deepEqual(result, { handled: true, output: 'ok' });
});
