#!/usr/bin/env node
/**
 * End-to-end smoke test for the tree browser, against a REAL session.
 *
 * Drives `get_tree` and `get_entry` over the wire and runs this client's own
 * row planner, fold reader and mark expansion over the answer. Reads only --
 * every mutating verb is left alone -- so it costs no tokens, needs no
 * reachable model, and cannot damage the session it reads.
 *
 * It works on a COPY. tau resolves a session by cwd, so the copy is placed in a
 * scratch session directory under the same cwd key and tau is started with
 * `--session-dir` pointing at it. The original is never opened.
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
import { cpSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { TauClient } from '../packages/protocol/dist/index.js';
import { TauProcess, StdioTransport } from '../packages/runner/dist/index.js';
import {
  foldAt,
  loadTree,
  marksSummary,
  planElide,
  planRows,
  toolGroup,
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

// The copy is filed under THIS process's cwd, not the session's original one:
// tau's catalog is scoped by cwd, so a copy filed under the directory it came
// from would not be listed here and the switch below would land somewhere else.
// The key is `session_dir_for_cwd`: `--` + the absolute path with its leading
// separator stripped and `/`, `\` and `:` flattened to `-` + `--`.
const scopeName = `--${process
  .cwd()
  .replace(/^[/\\]+/, '')
  .replace(/[/\\:]/g, '-')}--`;
const scratch = mkdtempSync(join(tmpdir(), 'tau-code-smoke-tree-'));
const scopeDir = join(scratch, scopeName);
mkdirSync(scopeDir, { recursive: true });
cpSync(picked, join(scopeDir, basename(picked)));
console.log(`reading a copy of ${picked}`);

const proc = new TauProcess({ sessionDir: scratch, extraArgs: ['--no-extensions'] });
proc.start((chunk) => process.stderr.write(`[tau stderr] ${chunk}`));

const transport = new StdioTransport(proc, (detail) => console.error('VIOLATION:', detail));
const client = new TauClient(transport);
client.on('protocolViolation', (detail, raw) => console.error('VIOLATION:', detail, raw));

function check(claim, ok) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${claim}`);
  if (!ok) process.exitCode = 1;
}

try {
  const caps = await client.connect();
  console.log(`protocol ${caps.protocol_version}`);

  const sessions = await client.call('list_sessions', {});
  const rows = sessions.sessions ?? [];
  if (rows.length === 0) throw new Error('the copy was not listed; --session-dir did not take');
  // Named, never defaulted. Falling back to "some session" here is how the
  // first run of this script reported OK against a one-entry session it had
  // just created, with every check passing and nothing measured.
  const wanted = basename(picked).replace(/\.jsonl$/, '').split('_').pop();
  const target = rows.find((row) => String(row.session_id) === wanted);
  if (!target) {
    throw new Error(
      `the copy (${wanted}) is not in list_sessions, which returned ` +
        `${rows.map((r) => String(r.session_id).slice(0, 8)).join(', ') || '(nothing)'}. ` +
        `tau scopes its catalog by cwd; the copy was filed under ${scopeName}.`,
    );
  }
  const switched = await client.call('switch_session', { session_id: String(target.session_id) });
  if (switched.cancelled) throw new Error('an extension vetoed the switch');

  const tree = await loadTree(client);
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

  // The detail pane's read, on a node the ACTIVE PATH does not contain -- which
  // is what `get_messages` could not have served.
  const path = new Set();
  let walk = tree.cursor;
  while (walk) {
    path.add(walk);
    walk = tree.byId.get(walk)?.parentId ?? null;
  }
  const offPath = tree.nodes.find((node) => !path.has(node.entryId));
  if (offPath) {
    const entry = await client.call('get_entry', { entry_id: offPath.entryId });
    check('get_entry reaches a node off the active path', entry.entry?.id === offPath.entryId);
  } else {
    console.log('get_entry: this session has no node off the active path');
  }

  let refused = false;
  try {
    await client.call('get_entry', { entry_id: 'no-such-entry' });
  } catch (error) {
    refused = String(error.message).includes('no-such-entry');
  }
  check('an unknown id refuses rather than answering null', refused);

  console.log(process.exitCode ? '\nFAILED' : '\nOK');
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await proc.stop();
}
