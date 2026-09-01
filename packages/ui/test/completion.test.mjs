/**
 * Tests for the completion logic, against synthetic vocabularies.
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
import { PERFORMABLE, performCommand } from '../dist/commands.js';

const COMMANDS = [
  { name: 'compact', description: 'compact the conversation', performer: 'frontend' },
  { name: 'tree', description: 'open the session-tree browser', performer: 'frontend' },
  { name: 'fork', description: 'open the session-tree browser', performer: 'frontend' },
  { name: 'extensions', description: 'list loaded extensions', performer: 'frontend' },
  { name: 'resume', description: 'open the session picker', performer: 'frontend' },
  { name: 'notes', description: 'an extension command', performer: 'core' },
];

/* ------------------------------------------------------------- /commands */

test('a bare slash offers the whole vocabulary', () => {
  const result = completeCommand('/', COMMANDS, PERFORMABLE);
  assert.equal(result.candidates.length, COMMANDS.length);
  assert.equal(result.token, '');
});

test('matching is a case-sensitive prefix test, like tau resolve_command', () => {
  assert.deepEqual(
    completeCommand('/co', COMMANDS, PERFORMABLE).candidates.map((c) => c.value),
    ['compact'],
  );
  assert.deepEqual(completeCommand('/CO', COMMANDS, PERFORMABLE).candidates, []);
});

test('built-ins come before extension commands', () => {
  const values = completeCommand('/', COMMANDS, PERFORMABLE).candidates.map((c) => c.value);
  assert.equal(values.indexOf('notes'), values.length - 1);
});

test('a command this head cannot perform is listed, not hidden', () => {
  const rows = completeCommand('/', COMMANDS, PERFORMABLE).candidates;
  const byName = Object.fromEntries(rows.map((r) => [r.value, r.available]));
  assert.equal(byName['compact'], true);
  assert.equal(byName['fork'], true);
  assert.equal(byName['resume'], true);
  assert.equal(byName['tree'], false, '/tree exists in tau; this head has not implemented it');
  assert.equal(byName['extensions'], false);
  assert.equal(byName['notes'], true, 'a core command is performed by tau itself');
});

test('an unknown slash gives an EMPTY match list, not null', () => {
  // Empty is the warning. Null would mean "show nothing", and the reader would
  // never learn that /zzz is about to be sent to the model as prose.
  const result = completeCommand('/zzz', COMMANDS, PERFORMABLE);
  assert.notEqual(result, null);
  assert.deepEqual(result.candidates, []);
});

test('an unknown word followed by a space is prose, and shows nothing', () => {
  // tau's own rule: someone pasted a path. A warning about it would be noise.
  assert.equal(completeCommand('/home/john/x file', COMMANDS, PERFORMABLE), null);
});

test('a KNOWN command followed by a space still completes', () => {
  const result = completeCommand('/resume abc', COMMANDS, PERFORMABLE);
  assert.deepEqual(
    result.candidates.map((c) => c.value),
    ['resume'],
  );
});

test('text that is not a slash line completes nothing', () => {
  assert.equal(completeCommand('hello there', COMMANDS, PERFORMABLE), null);
  assert.equal(completeCommand('', COMMANDS, PERFORMABLE), null);
});

test('a trailing space is still a bare token, matching tau strip()', () => {
  const result = completeCommand('/comp ', COMMANDS, PERFORMABLE);
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
  const completions = completeCommand('/comp', COMMANDS, PERFORMABLE);
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
  // A space already follows, so none is added: completing mid-sentence must not
  // accumulate one per Tab.
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
  // No space, and the cursor sits after the slash, so Tab descends.
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

test('a frontend command this head cannot perform is refused with a reason', async () => {
  const outcome = await performCommand('tree', '', {
    client: null,
    fork: async () => true,
    openSessions: () => {},
  });
  assert.equal(outcome.kind, 'refused');
  assert.match(outcome.notice, /tree browser is not built/);
});

test('/compact calls the compact verb', async () => {
  const calls = [];
  const outcome = await performCommand('compact', '', {
    client: {
      async call(method, params) {
        calls.push({ method, params });
        return {};
      },
    },
    fork: async () => true,
    openSessions: () => {},
  });
  assert.equal(outcome.kind, 'performed');
  assert.deepEqual(calls, [{ method: 'compact', params: {} }]);
});

test('a vetoed /fork is reported as refused, not as success', async () => {
  const outcome = await performCommand('fork', '', {
    client: null,
    fork: async () => false,
    openSessions: () => {},
  });
  assert.equal(outcome.kind, 'refused');
  assert.match(outcome.notice, /extension refused/);
});

test('/resume opens the picker and SAYS an argument was not used', async () => {
  let opened = false;
  const bare = await performCommand('resume', '', {
    client: null,
    fork: async () => true,
    openSessions: () => {
      opened = true;
    },
  });
  assert.equal(opened, true);
  assert.equal(bare.notice, '');

  const withArg = await performCommand('resume', '74ea1054', {
    client: null,
    fork: async () => true,
    openSessions: () => {},
  });
  // Never silently discarded: the TUI has an unfixed bug of exactly this shape.
  assert.match(withArg.notice, /74ea1054/);
});
