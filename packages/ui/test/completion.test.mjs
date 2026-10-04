/**
 * Tests for the completion logic and the command dispatch.
 *
 * The `/command` half is computed here, so it is tested here. The `@file` half
 * is computed by tau (`complete_path`), so what is tested here is only this
 * client's READING of that answer -- the check-then-narrow, and the span
 * arithmetic that puts a chosen path back into the text. tau's own matching
 * rules are tested on tau's side.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCandidate,
  commandSpan,
  completeCommand,
  completePath,
  nextIndex,
} from '../dist/completion.js';
import { VIEWS, performCommand } from '../dist/commands.js';
import { ServeError } from '@ffwf/tau-code-protocol';

/**
 * A synthetic vocabulary in `surface.commands`' shape (`CommandInfo`).
 *
 * `origin` says where the NAME came from, `flow` says whether the command
 * declares its arguments, and `hidden` marks the private registry name -- the
 * same rows RPC `get_commands` lists, built by the same code.
 *
 * `notes` carries its `ext:` twin because a real one always does: tau mints
 * `ext:<extension>.<command>` for every extension command and nothing can take
 * it away. A fixture with only the bare half would have made the popup look
 * correct while the wire it models says otherwise.
 */
const COMMANDS = [
  { name: 'compact', description: 'compact the conversation', origin: 'builtin', flow: true, hidden: false },
  { name: 'tree', description: 'open the session-tree browser', origin: 'builtin', flow: false, hidden: false },
  { name: 'fork', description: 'fork this session', origin: 'builtin', flow: true, hidden: false },
  { name: 'extensions', description: 'list loaded extensions', origin: 'builtin', flow: false, hidden: false },
  { name: 'model', description: 'switch the model', origin: 'builtin', flow: true, hidden: false },
  { name: 'notes', description: 'an extension command', origin: 'extension', flow: false, hidden: false },
  { name: 'ext:notebook.notes', description: 'an extension command', origin: 'extension', flow: false, hidden: true },
];

/** The rows a reader who has not typed `ext:` should ever see. */
const SHOWN = COMMANDS.filter((c) => !c.hidden);

const NONE = new Set();

/* ------------------------------------------------------------- /commands */

test('a bare slash offers the whole vocabulary', () => {
  const result = completeCommand('/', COMMANDS, NONE);
  assert.equal(result.candidates.length, SHOWN.length);
  assert.equal(result.token, '');
});

test('matching is a case-sensitive prefix test, like tau resolve_command', () => {
  assert.deepEqual(
    completeCommand('/co', COMMANDS, NONE).candidates.map((c) => c.value),
    ['compact'],
  );
  assert.deepEqual(completeCommand('/CO', COMMANDS, NONE).candidates, []);
});

test('built-ins come before extension commands', () => {
  // tau resolves in that order, so an extension that registered a built-in's
  // name is unreachable. Offering it first would advertise a command that
  // cannot run.
  const values = completeCommand('/', COMMANDS, NONE).candidates.map((c) => c.value);
  assert.equal(values.indexOf('notes'), values.length - 1);
});

test('a command this head cannot perform is listed, not hidden', () => {
  // Hiding it would say the command does not exist, when the truth is narrower
  // and more useful: it exists, and this head has no panel for it.
  const rows = completeCommand('/', COMMANDS, new Set(['tree'])).candidates;
  const byName = Object.fromEntries(rows.map((r) => [r.value, r.available]));
  assert.equal(byName['tree'], false);
  assert.equal(byName['compact'], true);
  assert.equal(byName['notes'], true);
});

test('the ext: twin is not offered until ext: is typed', () => {
  // Both halves run the same command. Showing them together doubles the list
  // and reads as two features.
  const bare = completeCommand('/note', COMMANDS, NONE).candidates.map((c) => c.value);
  assert.deepEqual(bare, ['notes']);

  const asked = completeCommand('/ext:', COMMANDS, NONE).candidates.map((c) => c.value);
  assert.deepEqual(asked, ['ext:notebook.notes']);
});

test('a hidden name is filtered for noise, never for reachability', () => {
  // It resolves in tau like any other name, so it is offered as available once
  // asked for -- the opposite of the `unavailable` set, which greys a command
  // this head genuinely cannot perform.
  const [row] = completeCommand('/ext:notebook', COMMANDS, NONE).candidates;
  assert.equal(row.value, 'ext:notebook.notes');
  assert.equal(row.available, true);
});

test('a tau older than 1.6 sends no hidden, and loses no commands', () => {
  // MINOR is additive: absent is that tau's real answer -- it marked nothing --
  // and its popup must behave exactly as it did before the field existed.
  const old = COMMANDS.filter((c) => !c.hidden).map(({ hidden, ...rest }) => rest);
  const values = completeCommand('/', old, NONE).candidates.map((c) => c.value);
  assert.deepEqual(values, old.map((c) => c.name));
});

test('an unknown slash gives an EMPTY match list, not null', () => {
  // Empty is the warning. Null would mean "show nothing", and the reader would
  // never learn that /zzz is about to be sent to the model as prose.
  const result = completeCommand('/zzz', COMMANDS, NONE);
  assert.notEqual(result, null);
  assert.deepEqual(result.candidates, []);
});

test('an unknown word followed by a space is prose, and shows nothing', () => {
  assert.equal(completeCommand('/home/john/x file', COMMANDS, NONE), null);
});

test('a KNOWN command followed by a space still completes', () => {
  const result = completeCommand('/model abc', COMMANDS, NONE);
  assert.deepEqual(
    result.candidates.map((c) => c.value),
    ['model'],
  );
});

test('text that is not a slash line completes nothing', () => {
  assert.equal(completeCommand('hello there', COMMANDS, NONE), null);
  assert.equal(completeCommand('', COMMANDS, NONE), null);
});

test('a trailing space is still a bare token, matching tau strip()', () => {
  const result = completeCommand('/comp ', COMMANDS, NONE);
  assert.deepEqual(
    result.candidates.map((c) => c.value),
    ['compact'],
  );
});

test('the span covers the sigil so applying replaces the whole word', () => {
  const span = commandSpan('  /comp');
  assert.equal(span.start, 2);
  assert.equal('  /comp'.slice(span.start, span.end), '/comp');
});

/* ---------------------------------------------------------- applying it */

test('applying a command replaces the span and adds a space', () => {
  const completions = completeCommand('/comp', COMMANDS, NONE);
  const applied = applyCandidate('/comp', completions, completions.candidates[0]);
  assert.equal(applied.text, '/compact ');
  assert.equal(applied.cursor, 9);
});

test('applying a file adds a trailing space; a directory does not', () => {
  const completions = {
    kind: 'path',
    start: 5,
    end: 8,
    token: 'no',
    candidates: [],
    total: 0,
  };
  const file = applyCandidate('read @no please', completions, {
    value: 'notes.txt',
    detail: '14 B',
    available: true,
  });
  assert.equal(file.text, 'read @notes.txt please');
  assert.equal(file.cursor, 15);

  const atEnd = applyCandidate('read @no', { ...completions, end: 8 }, {
    value: 'notes.txt',
    detail: '14 B',
    available: true,
  });
  assert.equal(atEnd.text, 'read @notes.txt ');
  assert.equal(atEnd.cursor, 16);

  const dir = applyCandidate('read @no please', completions, {
    value: 'sub/',
    detail: 'dir',
    available: true,
  });
  assert.equal(dir.text, 'read @sub/ please');
  assert.equal(dir.cursor, 10);
});

test('cycling wraps in both directions', () => {
  assert.equal(nextIndex(0, 3, false), 1);
  assert.equal(nextIndex(2, 3, false), 0);
  assert.equal(nextIndex(0, 3, true), 2);
  assert.equal(nextIndex(0, 0, false), 0);
});

/* ------------------------------------------------------------- @filename */

/**
 * A stand-in for a `SessionStore`: what `at()` hands a caller, and a client
 * whose `request` records what was sent and answers from `answer`.
 */
function fakeSession(answer = () => null) {
  const calls = [];
  const client = {
    async request(type, fields) {
      calls.push({ type, fields });
      return answer(type, fields);
    },
  };
  return {
    calls,
    session: {
      at: () => ({ client, session_id: 's1', cursor_id: 'c1' }),
      state: { cursor: { cursor_id: 'c1', leaf: 'L9', busy: false } },
    },
  };
}

test('completePath sends the session, the text and the caret offset', async () => {
  const { session, calls } = fakeSession(() => ({ completion: null }));
  const result = await completePath(session, 'read @no', 8);
  assert.equal(result, null, 'a null completion means "show no popup"');
  assert.deepEqual(calls[0], {
    type: 'complete_path',
    fields: { session_id: 's1', cursor_id: 'c1', text: 'read @no', offset: 8 },
  });
});

test('completePath reads matches into candidates', async () => {
  const { session } = fakeSession(() => ({
    completion: {
      start: 5,
      end: 8,
      token: 'no',
      matches: [
        { name: 'notes.txt', detail: '14 B', is_dir: false },
        { name: 'sub/', detail: 'dir', is_dir: true },
      ],
      total: 2,
    },
  }));
  const result = await completePath(session, 'read @no', 8);
  assert.equal(result.kind, 'path');
  assert.equal(result.start, 5);
  assert.deepEqual(
    result.candidates.map((c) => c.value),
    ['notes.txt', 'sub/'],
  );
});

test('an empty match list survives as a completion, because it is the warning', async () => {
  const { session } = fakeSession(() => ({ completion: { start: 0, end: 4, token: 'zzz', matches: [], total: 0 } }));
  const result = await completePath(session, '@zzz', 4);
  assert.notEqual(result, null);
  assert.deepEqual(result.candidates, []);
});

test('total is carried, so a bounded list can say it is bounded', async () => {
  const { session } = fakeSession(() => ({
    completion: { start: 0, end: 2, token: 'f', matches: [{ name: 'f000.txt', detail: '1 B', is_dir: false }], total: 207 },
  }));
  const result = await completePath(session, '@f', 2);
  assert.equal(result.total, 207);
  assert.equal(result.candidates.length, 1);
});

/* ------------------------------------------------------ performing them */

const MODEL_STEP = {
  flow: 'model',
  argument: { name: 'name', domain: 'model_name', description: '', required: true },
  domain: { name: 'model_name', description: '', free: false, values: null, enumerator: 'get_models', field_kind: 'select' },
  leaf: 'L9',
  bound: {},
};

function host(answer = () => null, answerStep = () => 'answered') {
  const { session, calls } = fakeSession(answer);
  const record = { calls, opened: [], asked: [], moved: [] };
  return {
    record,
    host: {
      session,
      daemon: {
        fork: async (at) => record.moved.push(['fork', at]),
        open: async (id) => record.moved.push(['open', id]),
      },
      openSessions: () => record.opened.push('sessions'),
      openView: (name) => {
        record.opened.push(name);
        return VIEWS.has(name);
      },
      askStep: async (step) => {
        record.asked.push(step.argument.name);
        return answerStep(step);
      },
    },
  };
}

test('a word tau does not know comes back as prose, for the model to see', async () => {
  const { host: h } = host();
  const outcome = await performCommand('zzz', '', COMMANDS, h);
  assert.equal(outcome.kind, 'prose');
});

test('a view opens this head panel and calls nothing', async () => {
  const { host: h, record } = host();
  assert.equal((await performCommand('tree', '', COMMANDS, h)).kind, 'performed');
  assert.equal((await performCommand('extensions', '', COMMANDS, h)).kind, 'performed');
  assert.deepEqual(record.opened, ['tree', 'extensions']);
  assert.deepEqual(record.calls, [], 'a view is head-local; tau is not asked');
  assert.deepEqual([...VIEWS].sort(), ['extensions', 'tree']);
});

test('a ready flow goes back to the daemon through perform_ready, not by mutation name', async () => {
  const ready = { flow: 'compact', mutation: 'compact', arguments: {} };
  const { host: h, record } = host((type) => {
    if (type === 'next_step') return { status: 'ready', ready, step: null };
    if (type === 'perform_ready') return { arm: 'Performed', mutation: 'compact', flow: 'compact', data: {} };
    return null;
  });
  const outcome = await performCommand('compact', '', COMMANDS, h);
  assert.equal(outcome.kind, 'performed');
  assert.deepEqual(
    record.calls.map((c) => c.type),
    ['next_step', 'perform_ready'],
  );
  assert.deepEqual(record.calls[0].fields, { session_id: 's1', cursor_id: 'c1', flow: 'compact', bound: {}, leaf: 'L9' });
  assert.deepEqual(record.calls[1].fields, { session_id: 's1', cursor_id: 'c1', ready });
  assert.deepEqual(record.asked, [], 'nothing was asked, because nothing was unbound');
});

test('a typed argument binds without asking, the way tau binds a command line', async () => {
  const { host: h, record } = host((type, fields) => {
    if (type === 'perform_ready') return { arm: 'Performed', mutation: 'set_model', flow: 'model', data: {} };
    return fields.bound.name === undefined
      ? { status: 'step', step: { ...MODEL_STEP, bound: fields.bound }, ready: null }
      : { status: 'ready', step: null, ready: { flow: 'model', mutation: 'set_model', arguments: fields.bound } };
  });
  const outcome = await performCommand('model', 'haiku-4.5', COMMANDS, h);
  assert.equal(outcome.kind, 'performed');
  assert.deepEqual(record.asked, [], '/model NAME must not open a picker for a name already typed');
  assert.deepEqual(record.calls.at(-1).fields.ready.arguments, { name: 'haiku-4.5' });
});

test('a bare flow asks for its argument, and a cancel performs nothing', async () => {
  const { host: h, record } = host(
    (type, fields) => ({ status: 'step', step: { ...MODEL_STEP, bound: fields.bound }, ready: null }),
    () => null,
  );
  const outcome = await performCommand('model', '', COMMANDS, h);
  assert.equal(outcome.kind, 'cancelled');
  assert.deepEqual(record.asked, ['name']);
  assert.deepEqual(
    record.calls.map((c) => c.type),
    ['next_step'],
    'a cancel sends no mutation -- tau is never told, because nothing was sent',
  );
});

test('a Ready the daemon hands back moves this head: fork forks at the cursor leaf', async () => {
  const { host: h, record } = host((type) =>
    type === 'next_step'
      ? { status: 'ready', step: null, ready: { flow: 'fork', mutation: 'fork', arguments: {} } }
      : { arm: 'Ready', flow: 'fork', mutation: 'fork', arguments: {} },
  );
  const outcome = await performCommand('fork', '', COMMANDS, h);
  assert.equal(outcome.kind, 'performed');
  assert.deepEqual(record.moved, [['fork', 'L9']]);
});

test('a Ready this head does not know is refused by name, not dropped', async () => {
  const { host: h } = host((type) =>
    type === 'next_step'
      ? { status: 'ready', step: null, ready: { flow: 'fork', mutation: 'fork', arguments: {} } }
      : { arm: 'Ready', flow: 'x', mutation: 'summon_daemon', arguments: {} },
  );
  const outcome = await performCommand('fork', '', COMMANDS, h);
  assert.equal(outcome.kind, 'refused');
  assert.match(outcome.notice, /summon_daemon/);
});

test('an extension command goes through submit, so the input hooks run', async () => {
  const { host: h, record } = host(() => ({
    accepted: true,
    admitted: false,
    submission_id: 'x',
    rejection_reason: null,
    dispatched: { arm: 'Performed', mutation: 'notes', flow: null, data: { output: 'noted' } },
  }));
  const outcome = await performCommand('notes', 'buy milk', COMMANDS, h);
  assert.equal(outcome.kind, 'performed');
  assert.equal(outcome.notice, 'noted');
  assert.equal(record.calls[0].type, 'submit');
  assert.equal(record.calls[0].fields.text, '/notes buy milk');
  assert.equal(record.calls[0].fields.expand_commands, true);
  assert.equal(record.calls[0].fields.multitask_strategy, 'enqueue');
  assert.equal(record.calls[0].fields.source, 'interactive', 'RPC provenance: a person typed this');
  assert.equal(record.calls[0].fields.submitter, 'human');
});

test('a refused submission says why, in τ’s words', async () => {
  const { host: h } = host(() => {
    throw new ServeError('submit', { code: -32000, message: 'locked by pirate', data: { submission_id: 'x' } });
  });
  const outcome = await performCommand('notes', '', COMMANDS, h);
  assert.deepEqual(outcome, { kind: 'refused', notice: 'locked by pirate' });
});
