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
import { VIEWS, loadCommands, performCommand } from '../dist/commands.js';

/**
 * A synthetic vocabulary in tau 0.10.0's shape.
 *
 * `performer` is gone; `origin` says where the NAME came from and `flow` says
 * whether the command declares its arguments. Both are what `get_commands`
 * actually sends -- this fixture is not a guess, it mirrors the schema.
 */
const COMMANDS = [
  { name: 'compact', description: 'compact the conversation', origin: 'builtin', flow: true },
  { name: 'tree', description: 'open the session-tree browser', origin: 'builtin', flow: false },
  { name: 'fork', description: 'fork this session', origin: 'builtin', flow: true },
  { name: 'extensions', description: 'list loaded extensions', origin: 'builtin', flow: false },
  { name: 'model', description: 'switch the model', origin: 'builtin', flow: true },
  { name: 'notes', description: 'an extension command', origin: 'extension', flow: false },
];

const NONE = new Set();

/* ------------------------------------------------------------- /commands */

test('a bare slash offers the whole vocabulary', () => {
  const result = completeCommand('/', COMMANDS, NONE);
  assert.equal(result.candidates.length, COMMANDS.length);
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

/* ------------------------------------------------------------ get_commands */

test('loadCommands reads origin and flow, and refuses a row missing either', async () => {
  const ok = await loadCommands({
    async call() {
      return { commands: [{ name: 'compact', description: 'd', origin: 'builtin', flow: true }] };
    },
  });
  assert.deepEqual(ok, [{ name: 'compact', description: 'd', origin: 'builtin', flow: true }]);

  // Fail Early: a protocol change surfaces here, once, naming the field. The
  // previous pass RECONSTRUCTED the removed `performer` from a hardcoded list
  // of five names, which is a copy of tau's own table with no way to notice
  // when tau's changes.
  await assert.rejects(
    () =>
      loadCommands({
        async call() {
          return { commands: [{ name: 'compact', description: 'd' }] };
        },
      }),
    /has no 'origin'/,
  );
  await assert.rejects(
    () =>
      loadCommands({
        async call() {
          return { commands: [{ name: 'x', description: '', origin: 'frontend', flow: false }] };
        },
      }),
    /not 'builtin' or 'extension'/,
  );
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

function pathClient(completion) {
  return {
    calls: [],
    async call(method, params) {
      this.calls.push({ method, params });
      return { completion };
    },
  };
}

test('completePath forwards the text and the cursor, not just the token', () => {
  const client = pathClient(null);
  return completePath(client, 'read @no', 8).then((result) => {
    assert.equal(result, null, 'a null completion means "show no popup"');
    assert.deepEqual(client.calls[0], {
      method: 'complete_path',
      params: { text: 'read @no', cursor: 8 },
    });
  });
});

test('completePath reads matches into candidates', async () => {
  const client = pathClient({
    start: 5,
    end: 8,
    token: 'no',
    matches: [
      { name: 'notes.txt', detail: '14 B', is_dir: false },
      { name: 'sub/', detail: 'dir', is_dir: true },
    ],
    total: 2,
  });
  const result = await completePath(client, 'read @no', 8);
  assert.equal(result.kind, 'path');
  assert.equal(result.start, 5);
  assert.deepEqual(
    result.candidates.map((c) => c.value),
    ['notes.txt', 'sub/'],
  );
});

test('an empty match list survives as a completion, because it is the warning', async () => {
  const client = pathClient({ start: 0, end: 4, token: 'zzz', matches: [], total: 0 });
  const result = await completePath(client, '@zzz', 4);
  assert.notEqual(result, null);
  assert.deepEqual(result.candidates, []);
});

test('total is carried, so a bounded list can say it is bounded', async () => {
  const client = pathClient({
    start: 0,
    end: 2,
    token: 'f',
    matches: [{ name: 'f000.txt', detail: '1 B', is_dir: false }],
    total: 207,
  });
  const result = await completePath(client, '@f', 2);
  assert.equal(result.total, 207);
  assert.equal(result.candidates.length, 1);
});

test('a malformed completion throws naming the field', async () => {
  const client = pathClient({ start: 0, end: 2, token: 'f', total: 1 });
  await assert.rejects(() => completePath(client, '@f', 2), /has no 'matches'/);
});

/* ------------------------------------------------------ performing them */

function host(overrides = {}) {
  const record = { calls: [], opened: [], asked: [] };
  return {
    record,
    host: {
      client: {
        capabilities: { commands: [{ name: 'compact' }, { name: 'set_model' }, { name: 'fork' }] },
        async call(method, params) {
          record.calls.push({ method, params });
          return overrides.answer ? overrides.answer(method, params) : {};
        },
      },
      refresh: async () => {},
      openSessions: () => record.opened.push('sessions'),
      openTree: () => record.opened.push('tree'),
      openExtensions: () => record.opened.push('extensions'),
      askStep: async (step) => {
        record.asked.push(step.argument.name);
        return overrides.answerStep ? overrides.answerStep(step) : 'answered';
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

test('a flow with no arguments goes straight to its mutation', async () => {
  const { host: h, record } = host({
    answer: (method) =>
      method === 'next_step'
        ? { status: 'ready', ready: { flow: 'fork', mutation: 'fork', arguments: {} } }
        : {},
  });
  const outcome = await performCommand('fork', '', COMMANDS, h);
  assert.equal(outcome.kind, 'performed');
  assert.deepEqual(
    record.calls.map((c) => c.method),
    ['next_step', 'fork'],
  );
  assert.deepEqual(record.asked, [], 'nothing was asked, because nothing was unbound');
});

test('a typed argument binds without asking, the way tau binds a command line', async () => {
  const seen = [];
  const { host: h, record } = host({
    answer: (method, params) => {
      if (method !== 'next_step') return {};
      seen.push(params.bound);
      return params.bound.name === undefined
        ? {
            status: 'step',
            step: {
              flow: 'model',
              argument: { name: 'name', domain: 'model_name', description: '', required: true },
              domain: { name: 'model_name', description: '', free: false, values: null, enumerator: 'get_models', field_kind: 'select' },
              bound: {},
            },
          }
        : { status: 'ready', ready: { flow: 'model', mutation: 'set_model', arguments: params.bound } };
    },
  });
  const outcome = await performCommand('model', 'haiku-4.5', COMMANDS, h);
  assert.equal(outcome.kind, 'performed');
  assert.deepEqual(record.asked, [], '/model NAME must not open a picker for a name already typed');
  assert.deepEqual(record.calls.at(-1), { method: 'set_model', params: { name: 'haiku-4.5' } });
});

test('a bare flow asks for its argument, and a cancel performs nothing', async () => {
  const { host: h, record } = host({
    answer: (method, params) =>
      method === 'next_step'
        ? {
            status: 'step',
            step: {
              flow: 'model',
              argument: { name: 'name', domain: 'model_name', description: '', required: true },
              domain: { name: 'model_name', description: '', free: false, values: null, enumerator: 'get_models', field_kind: 'select' },
              bound: params.bound,
            },
          }
        : {},
    answerStep: () => null,
  });
  const outcome = await performCommand('model', '', COMMANDS, h);
  assert.equal(outcome.kind, 'cancelled');
  assert.deepEqual(record.asked, ['name']);
  assert.deepEqual(
    record.calls.map((c) => c.method),
    ['next_step'],
    'a cancel sends no mutation -- tau is never told, because nothing was sent',
  );
});

test('a mutation this client was not generated against is refused, not dispatched', async () => {
  // Fail Early. Silently calling a verb the wire does not declare would earn a
  // METHOD_NOT_FOUND the reader cannot act on; this names the fix.
  const { host: h, record } = host({
    answer: (method) =>
      method === 'next_step'
        ? { status: 'ready', ready: { flow: 'x', mutation: 'summon_daemon', arguments: {} } }
        : {},
  });
  const outcome = await performCommand('fork', '', COMMANDS, h);
  assert.equal(outcome.kind, 'refused');
  assert.match(outcome.notice, /summon_daemon/);
  assert.match(outcome.notice, /npm run generate/);
  assert.deepEqual(
    record.calls.map((c) => c.method),
    ['next_step'],
  );
});

test('an extension command goes through submit, so the input hooks run', async () => {
  const { host: h, record } = host({
    answer: () => ({ command: { name: 'notes', output: 'noted' } }),
  });
  const outcome = await performCommand('notes', 'buy milk', COMMANDS, h);
  assert.equal(outcome.kind, 'performed');
  assert.equal(outcome.notice, 'noted');
  assert.equal(record.calls[0].method, 'submit');
  assert.equal(record.calls[0].params.text, '/notes buy milk');
  assert.equal(record.calls[0].params.expand_commands, true);
});
