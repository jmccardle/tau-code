/**
 * The conversation tree: rows, zones, and the plans a gesture would commit.
 *
 * These are the rules the tau TUI's own browser applies, re-derived here because
 * a TypeScript head cannot import a Python module. Where the rule reads off a
 * FACT, that fact comes from `get_tree` and is not inferred -- so the fixtures
 * below carry `first_kept_id`, `tool_call_ids`, `copyable` and `is_system` the
 * way tau sends them, and a test that had to invent one would be evidence the
 * projection is short a field.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchRefusal,
  commonAncestor,
  elideIneligible,
  enterMeaning,
  foldAt,
  isAncestor,
  marksSummary,
  pasteRefusal,
  pathTo,
  planElide,
  planRows,
  selectionOrder,
  subtreeOf,
  toggleMark,
  toolGroup,
  treeOf,
} from '../dist/tree.js';

/** One node in `get_tree`'s wire shape, with tau's defaults. */
function node(entry_id, parent_id, over = {}) {
  return {
    entry_id,
    parent_id,
    kind: 'message',
    role: null,
    preview: entry_id,
    is_cursor: false,
    timestamp: Number(entry_id.replace(/\D/g, '')) || 0,
    first_kept_id: null,
    from_id: null,
    is_system: false,
    tool_call_ids: [],
    tool_call_id: null,
    copyable: true,
    estimated_tokens: 10,
    ...over,
  };
}

function build(nodes, cursor) {
  return treeOf({ nodes, cursor, count: nodes.length });
}

/**
 * A system prompt, one user turn with a tool call and its result, then a second
 * user turn. The shape every rule below is about.
 */
function linear(cursor = 'e5') {
  return build(
    [
      node('e1', null, { role: 'system', is_system: true }),
      node('e2', 'e1', { role: 'user' }),
      node('e3', 'e2', { role: 'assistant', tool_call_ids: ['c1'] }),
      node('e4', 'e3', { role: 'toolResult', tool_call_id: 'c1' }),
      node('e5', 'e4', { role: 'assistant', is_cursor: cursor === 'e5' }),
      node('e6', 'e5', { role: 'user', is_cursor: cursor === 'e6' }),
    ],
    cursor,
  );
}

/* ------------------------------------------------------------- reading it */

test('a count that disagrees with the node list is refused, not trusted', () => {
  // The shape IS the answer, so a short tree is not a shorter answer -- it is a
  // different tree, and every rule below would be computed against it silently.
  assert.throws(() => treeOf({ nodes: [node('e1', null)], cursor: 'e1', count: 9 }), /different tree/);
});

test('a node missing a declared key throws naming it', () => {
  const bad = node('e1', null);
  delete bad.is_cursor;
  assert.throws(() => treeOf({ nodes: [bad], cursor: 'e1', count: 1 }), /has no 'is_cursor'/);
});

/* ------------------------------------------------------------------- rows */

test('a run of turns is a run of rows at one depth, not a staircase', () => {
  // The rule most likely to surprise: indentation counts turns and forks, and
  // nothing else. A hundred linear turns must be a hundred rows at depth 0.
  const nodes = [node('e1', null, { role: 'system', is_system: true })];
  for (let i = 2; i <= 21; i += 1) nodes.push(node(`e${i}`, `e${i - 1}`, { role: 'user' }));
  const rows = planRows(build(nodes, 'e21'));
  const users = rows.filter((row) => row.node.role === 'user');
  assert.equal(users.length, 20);
  assert.equal(new Set(users.map((row) => row.depth)).size, 1);
});

test("a user message owns its turn: the reply and the tool traffic hang off it", () => {
  const rows = planRows(linear());
  const byId = Object.fromEntries(rows.map((row) => [row.node.entryId, row]));
  const turn = byId['e2'];
  assert.equal(turn.isTurn, true);
  assert.equal(turn.hasChildren, true);
  // e3/e4/e5 are inside the turn e2 started...
  assert.equal(rows[byId['e3'].parent].node.entryId, 'e2');
  // ...and the NEXT user message is that group's sibling, not its child.
  assert.notEqual(byId['e6'].parent, rows.indexOf(turn));
  assert.equal(byId['e6'].depth, byId['e2'].depth);
});

test('a fork opens a level; a single child does not', () => {
  const forked = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant' }),
      node('e3', 'e1', { role: 'assistant' }),
    ],
    'e3',
  );
  const rows = planRows(forked);
  const byId = Object.fromEntries(rows.map((row) => [row.node.entryId, row]));
  assert.equal(byId['e2'].depth, byId['e3'].depth);
  assert.ok(byId['e2'].depth > byId['e1'].depth, 'a fork indents both branches');

  const straight = planRows(linear());
  const chain = straight.filter((row) => ['e3', 'e4', 'e5'].includes(row.node.entryId));
  assert.equal(new Set(chain.map((row) => row.depth)).size, 1, 'a run of one-child rows is siblings');
});

test('a navigate row with one child is not drawn, and its children re-hang', () => {
  // It carries no message and sits exactly where an extra row does the most
  // damage: between an answer and the turn forked off it.
  const withNav = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant' }),
      node('e3', 'e2', { kind: 'navigate', copyable: false }),
      node('e4', 'e3', { role: 'user' }),
    ],
    'e4',
  );
  const rows = planRows(withNav);
  assert.deepEqual(
    rows.map((row) => row.node.entryId),
    ['e1', 'e2', 'e4'],
  );
});

test('a navigate that is the cursor, or a real fork point, keeps its row', () => {
  // A browser that will not say where you are has failed at its one job; and a
  // navigate with two children is a branch point, so hiding it would draw two
  // branches as one run.
  const asCursor = build(
    [node('e1', null, { role: 'user' }), node('e2', 'e1', { kind: 'navigate', is_cursor: true })],
    'e2',
  );
  assert.ok(planRows(asCursor).some((row) => row.node.entryId === 'e2'));

  const asFork = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { kind: 'navigate' }),
      node('e3', 'e2', { role: 'user' }),
      node('e4', 'e2', { role: 'user' }),
    ],
    'e4',
  );
  assert.ok(planRows(asFork).some((row) => row.node.entryId === 'e2'));
});

test('an orphan is drawn as a root rather than dropped', () => {
  const broken = build([node('e1', null, { role: 'user' }), node('e9', 'gone', { role: 'user' })], 'e1');
  assert.deepEqual(
    planRows(broken).map((row) => row.node.entryId).sort(),
    ['e1', 'e9'],
  );
});

/* --------------------------------------------------------------- ancestry */

test('the path is root-first and cycle-guarded', () => {
  assert.deepEqual(pathTo(linear(), 'e5'), ['e1', 'e2', 'e3', 'e4', 'e5']);
  const looped = build([node('e1', 'e2'), node('e2', 'e1')], 'e1');
  assert.equal(pathTo(looped, 'e1').length, 2, 'a cycle terminates instead of hanging');
});

test('a subtree is parents before children', () => {
  assert.deepEqual(subtreeOf(linear(), 'e3'), ['e3', 'e4', 'e5', 'e6']);
});

test('isAncestor is strict: a node is not its own ancestor', () => {
  const tree = linear();
  assert.equal(isAncestor(tree, 'e2', 'e5'), true);
  assert.equal(isAncestor(tree, 'e5', 'e2'), false);
  assert.equal(isAncestor(tree, 'e5', 'e5'), false);
});

/* ------------------------------------------------------------------ folds */

test('the fold is read off first_kept_id, and carries the system prompt across', () => {
  // Everything on the path before the boundary leaves the model's input --
  // except a system message, which stays first. Getting this wrong silently
  // drops the system prompt, which is a bug tau itself shipped for months.
  const folded = build(
    [
      node('e1', null, { role: 'system', is_system: true }),
      node('e2', 'e1', { role: 'user' }),
      node('e3', 'e2', { role: 'assistant' }),
      node('e4', 'e3', { role: 'user' }),
      node('e5', 'e4', { kind: 'elide', copyable: false, first_kept_id: 'e4', is_cursor: true }),
    ],
    'e5',
  );
  const { folded: dropped, covered } = foldAt(folded, 'e5');
  assert.deepEqual([...dropped].sort(), ['e2', 'e3']);
  assert.ok(!dropped.has('e1'), 'the system prompt rides across the fold');
  assert.deepEqual([...covered].sort(), ['e2', 'e3'], 'the cursor IS the anchor, so it covers them');
});

test('covered is empty when the cursor is not the anchor', () => {
  const tree = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant' }),
      node('e3', 'e2', { kind: 'elide', copyable: false, first_kept_id: 'e2' }),
      node('e4', 'e3', { role: 'user', is_cursor: true }),
    ],
    'e4',
  );
  const { folded, covered } = foldAt(tree, 'e4');
  assert.deepEqual([...folded], ['e1']);
  assert.equal(covered.size, 0);
});

test('a path with no anchor folds nothing', () => {
  assert.equal(foldAt(linear(), 'e5').folded.size, 0);
});

/* ------------------------------------------------------------------ marks */

test('a mark takes its tool group with it, both ways', () => {
  // To every provider a call and its result are one unit: a branch carrying one
  // without the other is a prefix the API rejects. Pairing at mark time is what
  // lets the reader SEE the group rather than learn the rule from a refusal.
  const tree = linear();
  assert.deepEqual([...toolGroup(tree, 'e3')].sort(), ['e3', 'e4']);
  assert.deepEqual([...toolGroup(tree, 'e4')].sort(), ['e3', 'e4']);
  assert.deepEqual([...toolGroup(tree, 'e2')], ['e2'], 'an ordinary message is its own group');
});

test('unmarking either end releases the whole group', () => {
  const tree = linear();
  const marked = toggleMark(tree, new Set(), 'e3');
  assert.deepEqual([...marked].sort(), ['e3', 'e4']);
  assert.deepEqual([...toggleMark(tree, marked, 'e4')], []);
});

test('the readout never shows a token number bare', () => {
  // The only measured token figure in a session is usage.input_tokens on a
  // finished assistant message, which measures one request. A total over an
  // arbitrary set can only ever be an estimate, and saying so is a rule.
  const line = marksSummary(linear(), new Set(['e3', 'e4']), new Set(['e4']));
  assert.match(line, /2 nodes marked/);
  assert.match(line, /1 folded away/);
  assert.match(line, /common ancestor/);
  assert.match(line, /~20 tokens \(estimate\)/);
  assert.equal(marksSummary(linear(), new Set(), new Set()), '');
});

test('the common ancestor of a fork is the node they share', () => {
  const forked = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant' }),
      node('e3', 'e1', { role: 'assistant' }),
    ],
    'e3',
  );
  assert.equal(commonAncestor(forked, ['e2', 'e3']), 'e1');
  assert.equal(commonAncestor(forked, ['e2']), 'e2');
});

test('marks are ordered by the tree, not by the order they were pressed', () => {
  const rows = planRows(linear());
  assert.deepEqual(selectionOrder(rows, new Set(['e5', 'e2'])), ['e2', 'e5']);
});

/* ------------------------------------------------------------------ elide */

test('the two ends bracket what is KEPT, which everyone guesses backwards', () => {
  // Over [1..6], pairing 2 with 4 leaves [2,3,4] -- not [1,5,6]. An elide is the
  // summary-less compaction anchor, and a compaction keeps a tail.
  const tree = linear('e6');
  const plan = planElide(tree, 'e4', new Set(['e3']));
  assert.equal(plan.anchor, 'e4', 'the deeper of the two ends is the anchor');
  assert.equal(plan.firstKept, 'e3', 'the shallower is where the conversation resumes');
  // e1 and e2 are before the boundary; e1 is the system prompt and rides across,
  // so one entry is actually folded.
  assert.equal(plan.folded, 1);
});

test('which end is which is decided by the tree, not by the gesture order', () => {
  const tree = linear('e6');
  const a = planElide(tree, 'e4', new Set(['e3']));
  const b = planElide(tree, 'e3', new Set(['e4']));
  assert.deepEqual([a.anchor, a.firstKept], [b.anchor, b.firstKept]);
});

test('dropped counts what leaves the context now, which folded alone under-reports', () => {
  // With the cursor at e6, folding at e4 also abandons e5 and e6. The offer line
  // says what the reader loses, so it says the larger number.
  const tree = linear('e6');
  const plan = planElide(tree, 'e4', new Set(['e3']));
  assert.equal(plan.movesCursor, true);
  assert.ok(plan.dropped > plan.folded);
});

test('two rows on different branches cannot pair, and say so', () => {
  const forked = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant' }),
      node('e3', 'e1', { role: 'assistant', is_cursor: true }),
    ],
    'e3',
  );
  const plan = planElide(forked, 'e3', new Set(['e2']));
  assert.match(plan.refusal, /different branches/);
});

test('an elide that would hide nothing is refused by name', () => {
  // Resuming at the row that is already first-kept folds nothing. Here the only
  // entry before the boundary is the system prompt, which a fold carries across
  // rather than drops -- so the span really is empty, and saying "0 entries
  // folded" would be a gesture that appears to work and does not.
  const tree = build(
    [
      node('e1', null, { role: 'system', is_system: true }),
      node('e2', 'e1', { role: 'user', is_cursor: true }),
    ],
    'e2',
  );
  const plan = planElide(tree, 'e2', new Set());
  assert.match(plan.refusal, /hide nothing/);
});

test('more than one mark is not an elide, and says which gesture it is', () => {
  const plan = planElide(linear(), 'e5', new Set(['e2', 'e3']));
  assert.match(plan.refusal, /pairs two ends/);
});

test('greying is the ancestry rule alone, and only while exactly one row is marked', () => {
  const forked = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant' }),
      node('e3', 'e1', { role: 'assistant' }),
    ],
    'e3',
  );
  assert.deepEqual([...elideIneligible(forked, new Set(['e2']))], ['e3']);
  assert.equal(elideIneligible(forked, new Set()).size, 0);
  assert.equal(elideIneligible(forked, new Set(['e2', 'e3'])).size, 0);
});

/* ----------------------------------------------------------------- branch */

test('a branch refuses nothing marked, a structural row, and half a tool call', () => {
  const tree = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant', tool_call_ids: ['c1'] }),
      node('e3', 'e2', { role: 'toolResult', tool_call_id: 'c1' }),
      node('e4', 'e3', { kind: 'navigate', copyable: false }),
    ],
    'e4',
  );
  assert.match(branchRefusal(tree, new Set()), /Nothing is marked/);
  assert.match(branchRefusal(tree, new Set(['e4'])), /cannot go into a branch/);
  assert.match(branchRefusal(tree, new Set(['e2'])), /without its result/);
  assert.match(branchRefusal(tree, new Set(['e3'])), /nothing that made that call/);
  assert.equal(branchRefusal(tree, new Set(['e1', 'e2', 'e3'])), null);
});

/* ------------------------------------------------------------------ paste */

test('pasting into the copy own subtree is refused, including onto itself', () => {
  // The copy and the original would then be on one line of the conversation,
  // where a repeated tool-call id stops naming one call.
  const tree = linear();
  assert.match(pasteRefusal(tree, 'e3', 'e3'), /inside the copy itself/);
  assert.match(pasteRefusal(tree, 'e3', 'e5'), /inside the copy itself/);
  assert.equal(pasteRefusal(tree, 'e5', 'e2'), null);
});

test('a structural row cannot be a paste source', () => {
  const tree = build(
    [node('e1', null, { role: 'user' }), node('e2', 'e1', { kind: 'elide', copyable: false })],
    'e2',
  );
  assert.match(pasteRefusal(tree, 'e2', 'e1'), /cannot be copied/);
});

test('a copied result whose call is not coming with it is refused', () => {
  const tree = build(
    [
      node('e1', null, { role: 'user' }),
      node('e2', 'e1', { role: 'assistant', tool_call_ids: ['c1'] }),
      node('e3', 'e2', { role: 'toolResult', tool_call_id: 'c1' }),
      node('e4', 'e1', { role: 'user' }),
    ],
    'e4',
  );
  assert.match(pasteRefusal(tree, 'e3', 'e4'), /nothing made that call/);
  assert.equal(pasteRefusal(tree, 'e2', 'e4'), null, 'the call brings its result');
});

/* ------------------------------------------------------------------ enter */

test('Enter on your own message means ask it differently, not continue below it', () => {
  // Continuing below a user message would put two user turns in a row, which a
  // conversation cannot have.
  const tree = linear();
  assert.equal(enterMeaning(tree, 'e5'), 'navigate');
  assert.equal(enterMeaning(tree, 'e2'), 'revise');
});

test('the first entry has no parent, so there is nothing to fork from', () => {
  const tree = build([node('e1', null, { role: 'user', is_cursor: true })], 'e1');
  assert.equal(enterMeaning(tree, 'e1'), 'no-parent');
});
