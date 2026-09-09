import type { TauClient } from '@ffwf/tau-code-protocol';

/**
 * The conversation tree: rows, zones and the plans a gesture would commit.
 *
 * Pure, and separate from the component that draws it, for the same reason tau
 * keeps `plan_tree_rows` and `tree_surgery` out of its own widget: these are the
 * rules, and they are worth testing without a DOM.
 *
 * ## What this computes, and what tau decides
 *
 * tau owns the algebra. `navigate`, `elide_span`, `commit_branch`,
 * `paste_subtree` and `summarize_and_navigate` are verbs, each of which
 * validates against the live session and refuses with a sentence. This module
 * computes the OFFER -- which rows can pair, what a gesture would cost, which
 * rows to grey -- so the reader learns the rule from the screen instead of from
 * a refusal after they have finished selecting.
 *
 * The two can disagree, and when they do tau wins and its refusal is shown
 * verbatim. That is the same arrangement tau's own browser has: the manual says
 * the validation "runs before any append, twice -- once here, and once in the
 * backend against the live session".
 *
 * ## The one thing that is NOT a second copy
 *
 * Every per-node fact these rules read comes from `get_tree`: `first_kept_id` is
 * the fold's boundary, `tool_call_ids`/`tool_call_id` the pairing, `copyable`
 * the paste-source rule, `is_system` the carry-across. None of it is inferred
 * from the shape, because inferring it is exactly the drift that made the read
 * worth adding.
 */

/** One node of `get_tree`, in this client's casing. */
export interface TreeNode {
  entryId: string;
  parentId: string | null;
  kind: string;
  role: string | null;
  preview: string;
  isCursor: boolean;
  timestamp: number | null;
  firstKeptId: string | null;
  fromId: string | null;
  isSystem: boolean;
  toolCallIds: string[];
  toolCallId: string | null;
  copyable: boolean;
  estimatedTokens: number;
}

export interface Tree {
  nodes: TreeNode[];
  byId: Map<string, TreeNode>;
  childrenOf: Map<string | null, string[]>;
  cursor: string | null;
}

/** Read `get_tree` into the model below. */
export function treeOf(result: {
  nodes: readonly Record<string, unknown>[];
  cursor: string | null;
  count: number;
}): Tree {
  if (result.nodes.length !== result.count) {
    throw new TypeError(
      `get_tree() said count ${result.count} and sent ${result.nodes.length} nodes. ` +
        `The tree is the answer, so a short one is not a shorter answer -- it is a different tree.`,
    );
  }
  const nodes = result.nodes.map((raw, index) => {
    for (const key of ['entry_id', 'parent_id', 'kind', 'preview', 'is_cursor'] as const) {
      if (!(key in raw)) throw new TypeError(`get_tree().nodes[${index}] has no '${key}'.`);
    }
    const calls = raw['tool_call_ids'];
    return {
      entryId: String(raw['entry_id']),
      parentId: raw['parent_id'] === null ? null : String(raw['parent_id']),
      kind: String(raw['kind']),
      role: raw['role'] === null || raw['role'] === undefined ? null : String(raw['role']),
      preview: String(raw['preview']),
      isCursor: raw['is_cursor'] === true,
      timestamp: typeof raw['timestamp'] === 'number' ? raw['timestamp'] : null,
      firstKeptId: typeof raw['first_kept_id'] === 'string' ? raw['first_kept_id'] : null,
      fromId: typeof raw['from_id'] === 'string' ? raw['from_id'] : null,
      isSystem: raw['is_system'] === true,
      toolCallIds: Array.isArray(calls) ? calls.map(String) : [],
      toolCallId: typeof raw['tool_call_id'] === 'string' ? raw['tool_call_id'] : null,
      copyable: raw['copyable'] === true,
      estimatedTokens: typeof raw['estimated_tokens'] === 'number' ? raw['estimated_tokens'] : 0,
    } satisfies TreeNode;
  });

  const byId = new Map(nodes.map((node) => [node.entryId, node]));
  const childrenOf = new Map<string | null, string[]>();
  for (const node of nodes) {
    const siblings = childrenOf.get(node.parentId);
    if (siblings) siblings.push(node.entryId);
    else childrenOf.set(node.parentId, [node.entryId]);
  }
  return { nodes, byId, childrenOf, cursor: result.cursor };
}

/** Fetch and read the tree in one call. */
export async function loadTree(client: TauClient): Promise<Tree> {
  const result = await client.call('get_tree', {});
  return treeOf(result as unknown as Parameters<typeof treeOf>[0]);
}

// ── rows ─────────────────────────────────────────────────────────────────────

/** One row the browser draws, and where it sits. */
export interface TreeRow {
  node: TreeNode;
  /** Index into the row list of the row this one nests under; null is top level. */
  parent: number | null;
  depth: number;
  hasChildren: boolean;
  /** True for a row that opens a turn group -- a user message with traffic under it. */
  isTurn: boolean;
}

/**
 * Whether an entry gets no row at all.
 *
 * A `navigate` records that the cursor moved. It carries no message, it is not a
 * branch target worth naming, and it sits between an assistant message and the
 * user message forked off it -- the one place an extra row does the most damage
 * to the shape the reader is trying to read. Its children attach to its nearest
 * drawn ancestor, which reads as what actually happened.
 *
 * Two exceptions, neither of them tidiness: the cursor is never hidden, because
 * a browser that will not say where you are has failed at its one job; and a
 * `navigate` with more than one child is a real fork point, and hiding it would
 * draw two branches as one run.
 */
function isHidden(tree: Tree, node: TreeNode): boolean {
  if (node.kind !== 'navigate' || node.isCursor) return false;
  return (tree.childrenOf.get(node.entryId) ?? []).length <= 1;
}

/** `node`'s children with hidden ones spliced out, in order. */
function drawnChildren(tree: Tree, entryId: string | null): TreeNode[] {
  const drawn: TreeNode[] = [];
  for (const childId of tree.childrenOf.get(entryId) ?? []) {
    const child = tree.byId.get(childId);
    if (child === undefined) continue;
    if (isHidden(tree, child)) drawn.push(...drawnChildren(tree, childId));
    else drawn.push(child);
  }
  return drawn;
}

/**
 * Decide what the browser draws, under what, at what depth.
 *
 * **Two nesting rules, and they compose.** This is the part most likely to
 * surprise: indentation counts turns and forks, and nothing else.
 *
 * 1. **A fork opens a level.** A node with two or more drawn children indents
 *    each of them. A node with exactly one child does not -- the child is a
 *    sibling on the next line. So depth counts branches rather than messages,
 *    and does not grow as a conversation does.
 * 2. **A user message opens a level, and the next user message closes it.** Your
 *    message owns the turn it started: the reply, every tool call and every
 *    result hang off it. The next thing you asked is that group's SIBLING. A
 *    hundred linear turns is a hundred rows at depth 0, each holding its own
 *    traffic.
 *
 * The walk carries two containers to make rule 2 work. `current` is where an
 * ordinary row attaches; `outer` is where the NEXT user message attaches, which
 * is the group's own parent -- that is the whole of "the group closes at the next
 * user message". A fork sets both, since a fork's branches are the next turns.
 *
 * Iterative rather than recursive: a linear conversation is one frame per entry,
 * and a long session would blow the stack.
 */
export function planRows(tree: Tree): TreeRow[] {
  type Frame = { node: TreeNode; current: number | null; outer: number | null };
  const built: Array<{ node: TreeNode; parent: number | null; depth: number; isTurn: boolean }> = [];
  const parents = new Set<number>();

  // Roots are the nodes with no parent, plus orphans whose parent is not in the
  // tree at all -- a broken chain still gets drawn rather than dropped.
  const orphans = tree.nodes.filter(
    (node) => node.parentId !== null && !tree.byId.has(node.parentId) && !isHidden(tree, node),
  );
  const stack: Frame[] = [...drawnChildren(tree, null), ...orphans]
    .map((node) => ({ node, current: null, outer: null }))
    .reverse();

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { node, current, outer } = frame;

    const children = drawnChildren(tree, node.entryId);
    const isUser = node.role === 'user';
    const startsTurn = isUser && children.length > 0;
    // A user message attaches OUTSIDE the turn group that is open, which is the
    // whole of "the group closes at the next user message".
    const attachTo = isUser ? outer : current;

    const index = built.length;
    built.push({
      node,
      parent: attachTo,
      depth: attachTo === null ? 0 : built[attachTo]!.depth + 1,
      isTurn: startsTurn,
    });
    if (attachTo !== null) parents.add(attachTo);

    const forks = children.length > 1;
    // A fork sets both, since a fork's branches are the next turns. A turn sets
    // only `current`, and hands its own attach point down as the next turn's.
    // Neither: the children are siblings of this row, so both are unchanged --
    // that is what keeps a run of one-child entries flat.
    const childCurrent = forks || startsTurn ? index : current;
    const childOuter = forks ? index : startsTurn ? attachTo : outer;

    for (const child of [...children].reverse()) {
      stack.push({ node: child, current: childCurrent, outer: childOuter });
    }
  }

  return built.map((row, index) => ({
    node: row.node,
    parent: row.parent,
    depth: row.depth,
    hasChildren: parents.has(index),
    isTurn: row.isTurn,
  }));
}

// ── ancestry and folds ───────────────────────────────────────────────────────

/** The root→`entryId` chain, cycle-guarded. */
export function pathTo(tree: Tree, entryId: string | null): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = entryId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node = tree.byId.get(current);
    if (node === undefined) break;
    path.push(current);
    current = node.parentId;
  }
  return path.reverse();
}

/** `entryId` and everything under it, parents before children. */
export function subtreeOf(tree: Tree, entryId: string): string[] {
  const out: string[] = [];
  const stack = [entryId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    out.push(id);
    stack.push(...[...(tree.childrenOf.get(id) ?? [])].reverse());
  }
  return out;
}

/**
 * The entries on `cursor`'s path that a fold drops from the model's input.
 *
 * The splice, read off the boundary tau sends. The LAST splice anchor on the
 * path wins; everything before its `first_kept_id` leaves the context, except a
 * system message, which is carried across the fold and stays first.
 *
 * `covered` is the same span reported separately when the cursor IS the anchor
 * doing the dropping, so the browser can paint "these are the rows this row
 * hides" differently from "these are the rows some anchor hid".
 */
export function foldAt(tree: Tree, cursor: string | null): { folded: Set<string>; covered: Set<string> } {
  const empty = { folded: new Set<string>(), covered: new Set<string>() };
  if (cursor === null) return empty;

  const path = pathTo(tree, cursor);
  let anchorIndex = -1;
  for (let i = 0; i < path.length; i += 1) {
    const node = tree.byId.get(path[i]!);
    if (node !== undefined && (node.kind === 'compaction' || node.kind === 'elide')) anchorIndex = i;
  }
  if (anchorIndex === -1) return empty;

  const anchor = tree.byId.get(path[anchorIndex]!);
  const boundary = anchor?.firstKeptId ?? null;
  const folded = new Set<string>();
  let keeping = false;
  for (const id of path.slice(0, anchorIndex)) {
    if (id === boundary) keeping = true;
    if (keeping) continue;
    // The system prompt rides across the fold rather than being dropped.
    if (tree.byId.get(id)?.isSystem === true) continue;
    folded.add(id);
  }
  const covered = folded.size > 0 && anchor?.entryId === cursor ? new Set(folded) : new Set<string>();
  return { folded, covered };
}

// ── marks ────────────────────────────────────────────────────────────────────

/**
 * `entryId` together with the entries that cannot be separated from it.
 *
 * To every provider a tool call and its result are one unit: a branch carrying
 * the call without the result, or the result without the call, is a prefix the
 * API rejects. Expanding a mark to this set means the reader SEES the group
 * light up on the rows, instead of learning the rule from a refusal after they
 * have finished selecting.
 *
 * The pairing follows the tree, not the file: an assistant's results are looked
 * for below it, a result's call above it. If the same call was re-run on two
 * branches, one result comes with it, not both.
 */
export function toolGroup(tree: Tree, entryId: string): Set<string> {
  const node = tree.byId.get(entryId);
  if (node === undefined) return new Set([entryId]);

  if (node.toolCallIds.length > 0) {
    const wanted = new Set(node.toolCallIds);
    const found = new Map<string, string>();
    for (const id of subtreeOf(tree, entryId).slice(1)) {
      const call = tree.byId.get(id)?.toolCallId;
      if (call !== null && call !== undefined && wanted.has(call) && !found.has(call)) {
        found.set(call, id);
      }
    }
    return new Set([entryId, ...found.values()]);
  }

  if (node.toolCallId !== null) {
    for (const ancestorId of pathTo(tree, entryId).slice(0, -1).reverse()) {
      const ancestor = tree.byId.get(ancestorId);
      if (ancestor?.toolCallIds.includes(node.toolCallId) === true) return toolGroup(tree, ancestorId);
    }
  }

  return new Set([entryId]);
}

/** Add or remove `entryId` and its tool group. */
export function toggleMark(tree: Tree, marked: ReadonlySet<string>, entryId: string): Set<string> {
  const group = toolGroup(tree, entryId);
  const next = new Set(marked);
  if (next.has(entryId)) for (const id of group) next.delete(id);
  else for (const id of group) next.add(id);
  return next;
}

/** The lowest entry that is an ancestor of every id, or null. */
export function commonAncestor(tree: Tree, ids: Iterable<string>): string | null {
  let shared: string[] | null = null;
  for (const id of ids) {
    const path = pathTo(tree, id);
    if (shared === null) {
      shared = path;
      continue;
    }
    const limit = Math.min(shared.length, path.length);
    let i = 0;
    while (i < limit && shared[i] === path[i]) i += 1;
    shared = shared.slice(0, i);
  }
  return shared === null || shared.length === 0 ? null : shared[shared.length - 1]!;
}

/** Marks in the order the browser draws them, which is the order a branch takes them. */
export function selectionOrder(rows: readonly TreeRow[], marked: ReadonlySet<string>): string[] {
  return rows.map((row) => row.node.entryId).filter((id) => marked.has(id));
}

// ── the elide plan ───────────────────────────────────────────────────────────

/**
 * A legal `elide_span` call, worked out from the marked node and the cursor.
 *
 * **The two ends bracket what is KEPT, not what is removed.** This is the thing
 * about an elide almost everybody guesses backwards. Over `[1,2,3,4,5,6]`,
 * pairing 2 with 4 leaves `[2,3,4]` -- not `[1,5,6]`. An elide is the
 * summary-less form of the compaction anchor, and a compaction keeps a tail and
 * drops the head, so the kept region is always ONE contiguous run ending at the
 * deeper of the two nodes. Cutting a span out of the middle is not a shape this
 * operation can express at all.
 *
 * **Which of the two nodes is which is decided by the tree, not by the gesture
 * order.** The two ends are an ancestor and a descendant of each other, and the
 * deeper one is always the anchor. So the reader marks one node, puts the cursor
 * on the other, and does not have to remember which they picked first.
 *
 * Two counts, because they answer two questions and the first alone
 * under-reports: `folded` is what the fold itself drops, and `dropped` is what
 * leaves the context the model can see RIGHT NOW -- larger whenever the anchor
 * is not the current tip, because moving back to it abandons everything newer.
 */
export interface ElidePlan {
  anchor: string;
  firstKept: string;
  folded: number;
  dropped: number;
  movesCursor: boolean;
}

/** Whether `ancestorId` is on `descendantId`'s path (and not the same node). */
export function isAncestor(tree: Tree, ancestorId: string, descendantId: string): boolean {
  if (ancestorId === descendantId) return false;
  return pathTo(tree, descendantId).includes(ancestorId);
}

/**
 * The elide the current selection asks for, or the reason there is not one.
 *
 * `marked` empty means "keep from the cursor down", which is the ordinary case:
 * drop the old history and carry on. One mark pairs it with the cursor.
 */
export function planElide(
  tree: Tree,
  cursor: string | null,
  marked: ReadonlySet<string>,
): ElidePlan | { refusal: string } {
  if (cursor === null) return { refusal: 'There is no cursor to fold from.' };
  const marks = [...marked];
  if (marks.length > 1) {
    return { refusal: `An elide pairs two ends; ${marks.length} rows are marked. Unmark all but one.` };
  }

  const tip = tree.cursor;
  const other = marks[0] ?? cursor;
  let anchor: string;
  let firstKept: string;
  if (other === cursor) {
    // No pair: the cursor is the oldest entry kept, and the anchor is the tip.
    if (tip === null) return { refusal: 'There is no tip to hang the fold from.' };
    anchor = tip;
    firstKept = cursor;
  } else if (isAncestor(tree, other, cursor)) {
    anchor = cursor;
    firstKept = other;
  } else if (isAncestor(tree, cursor, other)) {
    anchor = other;
    firstKept = cursor;
  } else {
    return {
      refusal:
        'Those two rows are on different branches. The two ends of an elide must be on one ' +
        'line of the conversation -- one has to be an ancestor of the other.',
    };
  }

  const anchorPath = pathTo(tree, anchor);
  const boundary = anchorPath.indexOf(firstKept);
  if (boundary === -1) {
    return { refusal: 'The row to resume at is not on the path the fold would walk.' };
  }
  const foldedIds = anchorPath.slice(0, boundary).filter((id) => tree.byId.get(id)?.isSystem !== true);
  if (foldedIds.length === 0) {
    return { refusal: 'That would hide nothing — the span between those two nodes is already empty.' };
  }

  const currentPath = new Set(pathTo(tree, tip));
  const keptAfter = new Set(anchorPath.slice(boundary));
  const dropped = [...currentPath].filter(
    (id) => !keptAfter.has(id) && tree.byId.get(id)?.isSystem !== true,
  ).length;

  return {
    anchor,
    firstKept,
    folded: foldedIds.length,
    dropped: Math.max(dropped, foldedIds.length),
    movesCursor: anchor !== tip,
  };
}

/**
 * Rows that cannot be the other end of the elide the reader has started.
 *
 * Painted only while exactly one row is marked. The rule is ancestry alone: two
 * ends must be on one line of the conversation, so a cousin on another branch is
 * greyed. A legal pair whose span happens to be empty is NOT greyed here --
 * `planElide` names that one when the key is pressed, because greying it would
 * say "you cannot go there" about a row you can.
 */
export function elideIneligible(tree: Tree, marked: ReadonlySet<string>): Set<string> {
  const marks = [...marked];
  if (marks.length !== 1) return new Set();
  const mark = marks[0]!;
  const legal = new Set([...pathTo(tree, mark), ...subtreeOf(tree, mark)]);
  return new Set(tree.nodes.map((node) => node.entryId).filter((id) => !legal.has(id)));
}

// ── the branch and paste plans ───────────────────────────────────────────────

/**
 * Why `commit_branch` would refuse this selection, or null.
 *
 * An elide keeps a contiguous run; a branch keeps a SELECTION, with gaps in it,
 * by copying the messages that no longer follow one another. What it will not
 * take is a structural row -- a `navigate`, a fold anchor -- which names a
 * position in the tree the new branch is not at.
 */
export function branchRefusal(tree: Tree, marked: ReadonlySet<string>): string | null {
  const marks = [...marked];
  if (marks.length === 0) return 'Nothing is marked. Mark the messages the branch should keep.';
  for (const id of marks) {
    const node = tree.byId.get(id);
    if (node === undefined) return `${id} is not in this tree.`;
    if (!node.copyable) {
      return `A ${node.kind} row cannot go into a branch: it names a position in the tree the branch is not at.`;
    }
  }
  for (const id of marks) {
    const node = tree.byId.get(id)!;
    for (const call of node.toolCallIds) {
      const answered = [...marked].some((other) => tree.byId.get(other)?.toolCallId === call);
      if (!answered) {
        return `The call ${call} would go into the branch without its result, which every provider rejects.`;
      }
    }
    if (node.toolCallId !== null) {
      const declared = [...marked].some((other) => tree.byId.get(other)?.toolCallIds.includes(node.toolCallId!));
      if (!declared) {
        return `A result for ${node.toolCallId} would go into the branch with nothing that made that call.`;
      }
    }
  }
  return null;
}

/**
 * Why pasting `sourceId` under `targetId` would refuse, or null.
 *
 * The one that is not obvious: pasting into the copy's own subtree would put the
 * copy and the original on one line of the conversation, where a repeated
 * tool-call id stops naming one call.
 */
export function pasteRefusal(tree: Tree, sourceId: string, targetId: string): string | null {
  const source = tree.byId.get(sourceId);
  const target = tree.byId.get(targetId);
  if (source === undefined) return 'The copied row is no longer in this tree.';
  if (target === undefined) return 'That row is no longer in this tree.';
  if (!source.copyable) return `A ${source.kind} row cannot be copied.`;
  if (subtreeOf(tree, sourceId).includes(targetId)) {
    return 'That is inside the copy itself. The copy and the original would end up on one line of the conversation.';
  }
  const copied = subtreeOf(tree, sourceId);
  const onPath = new Set(pathTo(tree, targetId));
  for (const id of copied) {
    const node = tree.byId.get(id);
    if (node?.toolCallId == null) continue;
    const declared = [...copied, ...onPath].some((other) =>
      tree.byId.get(other)?.toolCallIds.includes(node.toolCallId!),
    );
    if (!declared) {
      return `The copy carries a result for ${node.toolCallId} onto a path where nothing made that call.`;
    }
  }
  return null;
}

// ── the readout ──────────────────────────────────────────────────────────────

/**
 * The line under the tree: what is marked, and what the next key would do.
 *
 * The word "estimate" is always there and the number is never shown bare. That
 * is a rule, not a hedge: the only measured token figure anywhere in a session
 * is `usage.input_tokens` on a finished assistant message, which measures one
 * request. A total over an arbitrary set of entries can only ever be a
 * 4-characters-per-token guess, and tau says so on every node it sends.
 */
export function marksSummary(
  tree: Tree,
  marked: ReadonlySet<string>,
  hiddenFromView: ReadonlySet<string>,
): string {
  const marks = [...marked];
  if (marks.length === 0) return '';
  const folded = marks.filter((id) => hiddenFromView.has(id)).length;
  const ancestor = commonAncestor(tree, marks);
  const tokens = marks.reduce((total, id) => total + (tree.byId.get(id)?.estimatedTokens ?? 0), 0);
  const parts = [`${marks.length} node${marks.length === 1 ? '' : 's'} marked`];
  if (folded > 0) parts.push(`(${folded} folded away)`);
  if (ancestor !== null) parts.push(`· common ancestor ${ancestor.slice(0, 8)}`);
  parts.push(`· ~${tokens.toLocaleString()} tokens (estimate)`);
  return parts.join(' ');
}

/** What Enter on this row means: continue below it, or ask it differently. */
export function enterMeaning(tree: Tree, entryId: string): 'navigate' | 'revise' | 'no-parent' {
  const node = tree.byId.get(entryId);
  if (node === undefined) return 'navigate';
  if (node.role !== 'user') return 'navigate';
  // Continuing below a user message would put two user turns in a row, which a
  // conversation cannot have -- so the cursor moves to its PARENT and the
  // message comes back in the composer to be edited.
  return node.parentId === null ? 'no-parent' : 'revise';
}
