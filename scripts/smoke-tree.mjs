#!/usr/bin/env node
/**
 * End-to-end smoke test for the tree browser, against a REAL session.
 *
 * Drives `get_tree` over the wire and runs this client's own row planner,
 * fold reader and mark expansion over the answer, and reads entry bodies from
 * the replica the way the detail pane does. Reads only -- every mutation is
 * left alone -- so it costs no tokens, needs no reachable model, and cannot
 * damage the session it reads.
 *
 * It works on a COPY, in a throwaway daemon's store (scripts/lib/daemon.mjs).
 * The original is never opened.
 *
 * Synthetic fixtures cannot replace this. The shapes that make the browser worth
 * having -- a `navigate` between an answer and the turn forked off it, a
 * `branch_summary` naming an abandoned line, an `elide` with a real
 * `firstKeptId` -- are what a session accumulates, and the planner's rules are
 * about exactly those.
 *
 *   TAU_BIN=/path/to/venv/bin/tau node scripts/smoke-tree.mjs [SESSION.jsonl]
 *
 * With no argument it picks the largest session under ~/.tau/sessions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Replica } from '../packages/protocol/dist/index.js';
import { check, connect, startDaemon } from './lib/daemon.mjs';
import {
  foldAt,
  marksSummary,
  planElide,
  planRows,
  toolGroup,
  treeOf,
} from '../packages/ui/dist/tree.js';

const HOME_SESSIONS = join(process.env.HOME ?? '', '.tau', 'sessions');

/** Every session log under `~/.tau/sessions`, largest first. */
function everySession() {
  const found = [];
  for (const scope of readdirSync(HOME_SESSIONS, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const dir = join(HOME_SESSIONS, scope.name);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const path = join(dir, file);
      found.push({ path, size: statSync(path).size });
    }
  }
  return found.sort((a, b) => b.size - a.size);
}

const picked = process.argv[2] ?? everySession()[0]?.path;
if (!picked) {
  console.error(`No session logs under ${HOME_SESSIONS}. Pass one as an argument.`);
  process.exit(1);
}

// The session's own cwd, from its header line: the daemon files a session
// under the cwd it belongs to, and that is where the copy goes.
const header = JSON.parse(readFileSync(picked, 'utf8').split('\n')[0]);
console.log(`reading a copy of ${picked}`);
const daemon = await startDaemon({ sessions: [{ path: picked, cwd: header.cwd }] });
const client = await connect(daemon.url, 'smoke-tree');
client.on('protocolViolation', (detail, raw) => console.error('VIOLATION:', detail, raw));

try {
  console.log(`protocol ${client.helloResult.protocol}`);

  const { sessions: rows } = await client.request('list_sessions', {});
  // Named, never defaulted. Falling back to "some session" here is how the
  // first run of this script reported OK against a one-entry session it had
  // just created, with every check passing and nothing measured.
  const wanted = header.id;
  const target = rows.find((row) => row.session_id === wanted);
  if (!target) {
    throw new Error(
      `the copy (${wanted}) is not in list_sessions, which returned ` +
        `${rows.map((r) => r.session_id.slice(0, 8)).join(', ') || '(nothing)'}.`,
    );
  }
  const attached = await client.request('attach', { session_id: wanted });
  const replica = new Replica(wanted);
  replica.applyAttached(attached);
  const cursorId = attached.head_cursor_id;

  const tree = treeOf(await client.request('get_tree', { session_id: wanted, cursor_id: cursorId }));
  console.log(`\ntree: ${tree.nodes.length} entries, cursor ${tree.cursor?.slice(0, 8) ?? 'none'}`);

  const kinds = {};
  for (const node of tree.nodes) kinds[node.kind] = (kinds[node.kind] ?? 0) + 1;
  console.log(`  kinds: ${JSON.stringify(kinds)}`);

  check(
    'every node resolves its parent, or is a declared orphan',
    tree.nodes.every((node) => node.parentId === null || tree.byId.has(node.parentId)),
  );
  check('exactly one node is the cursor', tree.nodes.filter((n) => n.isCursor).length === 1);
  check(
    'the cursor key and the flagged node agree',
    tree.nodes.find((n) => n.isCursor)?.entryId === tree.cursor,
  );

  const rowsPlanned = planRows(tree);
  console.log(`rows: ${rowsPlanned.length} drawn (${tree.nodes.length - rowsPlanned.length} hidden)`);
  const depths = rowsPlanned.map((row) => row.depth);
  console.log(`  max depth ${Math.max(...depths)} over ${tree.nodes.length} entries`);
  check(
    'depth counts forks and turns, not messages',
    Math.max(...depths) < Math.max(8, Math.log2(tree.nodes.length) * 3),
  );
  check(
    'every drawn row attaches to a row that exists',
    rowsPlanned.every((row) => row.parent === null || rowsPlanned[row.parent] !== undefined),
  );
  check(
    'a hidden row is a navigate with at most one child and is not the cursor',
    tree.nodes
      .filter((node) => !rowsPlanned.some((row) => row.node.entryId === node.entryId))
      .every(
        (node) =>
          node.kind === 'navigate' &&
          !node.isCursor &&
          (tree.childrenOf.get(node.entryId) ?? []).length <= 1,
      ),
  );

  const { folded, covered } = foldAt(tree, tree.cursor);
  console.log(`fold at the cursor: ${folded.size} folded, ${covered.size} covered`);
  const anchors = tree.nodes.filter((n) => n.firstKeptId !== null);
  console.log(`  ${anchors.length} splice anchors in the log, each naming its boundary`);
  check(
    'no anchor names a boundary that is not in the tree',
    anchors.every((node) => tree.byId.has(node.firstKeptId)),
  );

  const paired = tree.nodes.find((node) => node.toolCallIds.length > 0);
  if (paired) {
    const group = toolGroup(tree, paired.entryId);
    console.log(`tool group for ${paired.entryId.slice(0, 8)}: ${group.size} entries`);
    check('a call and its result mark together', group.size > 1);
    check(
      'marking the result reaches the same group',
      [...group].every((id) => id === paired.entryId || toolGroup(tree, id).has(paired.entryId)),
    );
    console.log(`  readout: ${marksSummary(tree, group, new Set())}`);
    check('the readout says estimate', marksSummary(tree, group, new Set()).includes('(estimate)'));
  } else {
    console.log('tool group: this session has no tool calls to pair');
  }

  const plan = planElide(tree, tree.cursor, new Set());
  console.log(`elide from the cursor: ${'refusal' in plan ? plan.refusal : JSON.stringify(plan)}`);

  // The detail pane reads bodies from the replica, including nodes the active
  // path does not contain. Every row get_tree drew has to be there.
  check(
    'the replica holds every entry the tree names',
    tree.nodes.every((node) => replica.entries.has(node.entryId)),
  );
  check('the replica and the tree agree on the size of the session', replica.entries.size === tree.nodes.length);

  console.log(process.exitCode ? '\nFAILED' : '\nOK');
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  client.close();
  await daemon.stop();
}
