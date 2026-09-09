import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TauClient } from '@ffwf/tau-code-protocol';
import { readEntry, type Entry } from './messages.js';
import { describe } from './useTau.js';
import {
  branchRefusal,
  commonAncestor,
  elideIneligible,
  enterMeaning,
  foldAt,
  loadTree,
  marksSummary,
  pathTo,
  pasteRefusal,
  planElide,
  planRows,
  selectionOrder,
  subtreeOf,
  toggleMark,
  type ElidePlan,
  type Tree,
  type TreeRow,
} from './tree.js';

/**
 * The conversation tree browser.
 *
 * A tau conversation is a TREE, not a list. Branching back to an earlier point
 * does not delete what came after -- it leaves it in place as a sibling and
 * starts a new line. Compaction and elide do not delete either; they insert an
 * anchor saying where a span was folded out of the model's input. The transcript
 * can only show one line through that tree. This shows the whole thing, and lets
 * the reader move to a different point in it or fold part of it away.
 *
 * ## Nothing is written while this is open
 *
 * Every gesture builds state in memory. A key that commits calls one verb and
 * closes; Escape discards all of it. That is the arrangement tau's own browser
 * has, and it is what makes a refusal cheap: the panel is still open, on the row
 * the reader was looking at, and they can move and try again.
 *
 * ## Why the keys are these keys
 *
 * They are the TUI's, so that someone who has used one has used the other.
 * `Ctrl+D` folds the detail pane and not the `Ctrl+M` that would have been
 * obvious, because a terminal sends the same byte for Enter and Ctrl+M -- the
 * constraint does not apply in a browser, and matching the TUI matters more than
 * relitigating it here.
 */

const KEY_LINE = '↵ pick · Space mark · ←→ fold · ^E elide · ^B branch · c copy · v paste · ^D pane · Esc';

/** The zone a row wears, first match wins. What you did to a row outranks what it is. */
type Zone =
  | 'marked'
  | 'ineligible'
  | 'copied'
  | 'covered'
  | 'folded'
  | 'summary'
  | 'abandoned'
  | 'path'
  | null;

interface Zones {
  marked: ReadonlySet<string>;
  ineligible: ReadonlySet<string>;
  copied: ReadonlySet<string>;
  covered: ReadonlySet<string>;
  folded: ReadonlySet<string>;
  summary: ReadonlySet<string>;
  abandoned: ReadonlySet<string>;
  path: ReadonlySet<string>;
}

/**
 * Which class a row takes, in priority order.
 *
 * `path` is last because it is true of a whole chain and would otherwise swallow
 * everything else.
 */
function zoneOf(zones: Zones, entryId: string): Zone {
  if (zones.marked.has(entryId)) return 'marked';
  if (zones.ineligible.has(entryId)) return 'ineligible';
  if (zones.copied.has(entryId)) return 'copied';
  if (zones.covered.has(entryId)) return 'covered';
  if (zones.folded.has(entryId)) return 'folded';
  if (zones.summary.has(entryId)) return 'summary';
  if (zones.abandoned.has(entryId)) return 'abandoned';
  if (zones.path.has(entryId)) return 'path';
  return null;
}

/** The word a row starts with, coloured on its own so the left edge is scannable. */
function tagOf(kind: string, role: string | null): string {
  if (kind === 'message' || kind === 'customMessage') return role ?? kind;
  return kind;
}

/**
 * Each `branch_summary` and the head of the line it is about.
 *
 * A fixed property of the log's shape rather than a selection, so it is computed
 * once per tree rather than per cursor move.
 */
function summaryPairs(tree: Tree): { summary: Set<string>; abandoned: Set<string> } {
  const summary = new Set<string>();
  const abandoned = new Set<string>();
  for (const node of tree.nodes) {
    if (node.kind !== 'branch_summary') continue;
    summary.add(node.entryId);
    if (node.fromId !== null && tree.byId.has(node.fromId)) abandoned.add(node.fromId);
  }
  return { summary, abandoned };
}

/** What the reader is about to be asked after Enter. */
type Chooser =
  | { kind: 'branch'; entryId: string }
  | { kind: 'revise'; entryId: string; text: string }
  | { kind: 'instructions'; entryId: string; draft: string }
  | { kind: 'branchMode' }
  | null;

export interface TreePanelProps {
  client: TauClient | null;
  /** Re-read the transcript after a mutation moved the cursor. */
  onChanged: () => Promise<void> | void;
  /** Put a user message back in the composer, for the "ask this differently" case. */
  onRevise?: (text: string) => void;
  onClose: () => void;
  /** True while a turn is running: every tree mutation refuses then, so say so first. */
  running: boolean;
}

export function TreePanel({ client, onChanged, onRevise, onClose, running }: TreePanelProps): JSX.Element {
  const [tree, setTree] = useState<Tree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [cursor, setCursor] = useState<string | null>(null);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [paneHidden, setPaneHidden] = useState(false);
  const [chooser, setChooser] = useState<Chooser>(null);

  const list = useRef<HTMLDivElement>(null);

  const reload = useCallback(async (): Promise<Tree | null> => {
    if (!client) return null;
    try {
      const loaded = await loadTree(client);
      setTree(loaded);
      setError(null);
      setCursor((current) => (current !== null && loaded.byId.has(current) ? current : loaded.cursor));
      return loaded;
    } catch (raw) {
      setError(describe(raw));
      return null;
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Focus the panel as it opens. Without this the arrow keys do nothing until
  // the reader clicks somewhere they have not been told about, which reads as
  // a browser whose keys are broken. Once only: re-focusing on every render
  // would steal the caret from a dialog's own input.
  useEffect(() => {
    if (tree !== null) list.current?.focus();
  }, [tree !== null]);

  const rows = useMemo<TreeRow[]>(() => (tree === null ? [] : planRows(tree)), [tree]);

  /**
   * Rows a collapsed ancestor hides.
   *
   * A turn mounts collapsed and everything else mounts open, except the groups
   * the cursor row is actually inside -- its WIDGET ancestors, not its parentId
   * ancestors, and the difference is the whole rule. In a linear conversation
   * every earlier user message is a parentId ancestor of the cursor and none of
   * them is a widget ancestor, because a turn group's next sibling is the next
   * turn.
   */
  const openByDefault = useMemo<Set<number>>(() => {
    const open = new Set<number>();
    if (tree === null) return open;
    const cursorRow = rows.findIndex((row) => row.node.entryId === (cursor ?? tree.cursor));
    let walk = cursorRow;
    while (walk >= 0) {
      const parent = rows[walk]?.parent ?? null;
      if (parent === null) break;
      open.add(parent);
      walk = parent;
    }
    return open;
  }, [rows, tree, cursor]);

  /**
   * Whether a row is folded shut.
   *
   * **A turn mounts folded and everything else mounts open**, and `toggled`
   * holds the rows the reader has flipped AWAY from that default. One set, not
   * two: a set of "closed rows" cannot say whether a turn is open because it was
   * opened or because it was never shut, and the difference is what makes the
   * cursor's own turn stay open when the reader collapses a different one.
   */
  const isShut = useCallback(
    (index: number): boolean => {
      const row = rows[index];
      if (row === undefined || !row.hasChildren) return false;
      const byDefault = row.isTurn && !openByDefault.has(index);
      return byDefault !== toggled.has(index);
    },
    [rows, openByDefault, toggled],
  );

  const hiddenRows = useMemo<Set<string>>(() => {
    const hidden = new Set<string>();
    const shut = new Set<number>();
    rows.forEach((row, index) => {
      const parentShut = row.parent !== null && shut.has(row.parent);
      if (parentShut) hidden.add(row.node.entryId);
      if (parentShut || isShut(index)) shut.add(index);
    });
    return hidden;
  }, [rows, isShut]);

  const zones = useMemo<Zones>(() => {
    if (tree === null) {
      const none = new Set<string>();
      return {
        marked: none,
        ineligible: none,
        copied: none,
        covered: none,
        folded: none,
        summary: none,
        abandoned: none,
        path: none,
      };
    }
    const fold = foldAt(tree, cursor);
    const pairs = summaryPairs(tree);
    return {
      marked,
      ineligible: elideIneligible(tree, marked),
      copied: copied === null ? new Set<string>() : new Set(subtreeOf(tree, copied)),
      covered: fold.covered,
      folded: fold.folded,
      summary: pairs.summary,
      abandoned: pairs.abandoned,
      path: new Set(pathTo(tree, cursor)),
    };
  }, [tree, cursor, marked, copied]);

  /**
   * The history the hovered row and the cursor share, and where it diverges.
   *
   * One continuous thread from the root to the row being pointed at. Where it
   * turns amber is where that row's history stops being yours -- the answer to
   * "what would I be picking up if I went there?".
   */
  const hover = useMemo<{ common: Set<string>; divergent: Set<string> }>(() => {
    if (tree === null || hovered === null || hovered === cursor) {
      return { common: new Set(), divergent: new Set() };
    }
    const mine = new Set(pathTo(tree, cursor));
    const theirs = pathTo(tree, hovered);
    const common = new Set<string>();
    const divergent = new Set<string>();
    for (const id of theirs) (mine.has(id) ? common : divergent).add(id);
    return { common, divergent };
  }, [tree, hovered, cursor]);

  const elide = useMemo<ElidePlan | { refusal: string } | null>(
    () => (tree === null ? null : planElide(tree, cursor, marked)),
    [tree, cursor, marked],
  );

  const visible = useMemo(
    () => rows.filter((row) => !hiddenRows.has(row.node.entryId)),
    [rows, hiddenRows],
  );

  // ── the verbs ──────────────────────────────────────────────────────────────

  const perform = useCallback(
    async (what: string, run: () => Promise<unknown>): Promise<void> => {
      if (running) {
        setNotice(`A turn is running. ${what} would be refused until it finishes — stop it first.`);
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        await run();
        await onChanged();
        await reload();
      } catch (raw) {
        // tau's refusal, verbatim. It validated against the live session, which
        // this panel's own offer only approximates.
        setNotice(describe(raw));
      } finally {
        setBusy(false);
      }
    },
    [running, onChanged, reload],
  );

  const navigate = useCallback(
    async (entryId: string, instructions: string | null, summarize: boolean): Promise<void> => {
      if (!client) return;
      await perform('Moving the cursor', async () => {
        if (summarize) {
          await client.call('summarize_and_navigate', {
            target_id: entryId,
            ...(instructions === null || instructions === '' ? {} : { custom_instructions: instructions }),
          });
        } else {
          await client.call('navigate', { target_id: entryId });
        }
      });
      setChooser(null);
      onClose();
    },
    [client, perform, onClose],
  );

  const commitElide = useCallback(async (): Promise<void> => {
    if (!client || elide === null) return;
    if ('refusal' in elide) {
      setNotice(elide.refusal);
      return;
    }
    await perform('An elide', () =>
      client.call('elide_span', { anchor_id: elide.anchor, first_kept_id: elide.firstKept }),
    );
    setMarked(new Set());
    onClose();
  }, [client, elide, perform, onClose]);

  const commitBranch = useCallback(
    async (dropContext: boolean): Promise<void> => {
      if (!client || tree === null) return;
      const refusal = branchRefusal(tree, marked);
      if (refusal !== null) {
        setNotice(refusal);
        setChooser(null);
        return;
      }
      await perform('A branch', () =>
        client.call('commit_branch', {
          ids: selectionOrder(rows, marked),
          drop_context: dropContext,
        }),
      );
      setMarked(new Set());
      setChooser(null);
      onClose();
    },
    [client, tree, marked, rows, perform, onClose],
  );

  const commitPaste = useCallback(async (): Promise<void> => {
    if (!client || tree === null || copied === null || cursor === null) return;
    const refusal = pasteRefusal(tree, copied, cursor);
    if (refusal !== null) {
      setNotice(refusal);
      return;
    }
    // A paste changes the TREE, not the conversation: the leaf never moves, so
    // the panel stays open on the grown tree rather than closing on a cursor
    // that did not go anywhere. The clipboard survives, so one copy can go to
    // several places.
    await perform('A paste', () => client.call('paste_subtree', { source_id: copied, target_id: cursor }));
    setNotice('Pasted. The conversation is unchanged — press Enter on the copy to continue from it.');
  }, [client, tree, copied, cursor, perform]);

  // ── keys ───────────────────────────────────────────────────────────────────

  const move = useCallback(
    (delta: number): void => {
      const index = visible.findIndex((row) => row.node.entryId === cursor);
      const next = visible[Math.min(Math.max(index + delta, 0), visible.length - 1)];
      if (next) setCursor(next.node.entryId);
    },
    [visible, cursor],
  );

  const foldRow = useCallback(
    (open: boolean, at?: number): void => {
      const index = at ?? rows.findIndex((row) => row.node.entryId === cursor);
      const row = rows[index];
      if (row === undefined) return;
      if (!row.hasChildren) {
        // Nothing to fold. Left moves OUT to the row that contains this one,
        // which is what makes Left twice fold the turn you were inside.
        if (!open && row.parent !== null) setCursor(rows[row.parent]!.node.entryId);
        return;
      }
      if (open === !isShut(index)) return;
      const next = new Set(toggled);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      setToggled(next);
    },
    [rows, cursor, toggled, isShut],
  );

  const onKey = useCallback(
    (event: React.KeyboardEvent): void => {
      if (tree === null || chooser !== null) return;
      const key = event.key;
      const ctrl = event.ctrlKey || event.metaKey;

      if (key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        move(key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        event.preventDefault();
        foldRow(key === 'ArrowRight');
        return;
      }
      if (key === ' ') {
        event.preventDefault();
        if (cursor !== null) setMarked(toggleMark(tree, marked, cursor));
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        if (cursor === null) return;
        const meaning = enterMeaning(tree, cursor);
        if (meaning === 'no-parent') {
          setNotice(
            'That is the first entry in the session, so there is nothing to fork from. ' +
              'Pick a later message.',
          );
          return;
        }
        if (meaning === 'revise') {
          void openRevise(cursor);
          return;
        }
        setChooser({ kind: 'branch', entryId: cursor });
        return;
      }
      if (ctrl && (key === 'e' || key === 'E')) {
        event.preventDefault();
        void commitElide();
        return;
      }
      if (ctrl && (key === 'b' || key === 'B')) {
        event.preventDefault();
        const refusal = branchRefusal(tree, marked);
        if (refusal !== null) setNotice(refusal);
        else setChooser({ kind: 'branchMode' });
        return;
      }
      if (ctrl && (key === 'd' || key === 'D')) {
        event.preventDefault();
        setPaneHidden((hidden) => !hidden);
        return;
      }
      if (!ctrl && key === 'c' && cursor !== null) {
        event.preventDefault();
        const node = tree.byId.get(cursor);
        if (node?.copyable !== true) {
          setNotice(`A ${node?.kind ?? 'structural'} row names a position in the tree, so it cannot be copied.`);
          return;
        }
        setCopied(cursor);
        setNotice(null);
        return;
      }
      if (!ctrl && key === 'v' && copied !== null) {
        event.preventDefault();
        void commitPaste();
      }
    },
    [tree, chooser, cursor, marked, copied, move, foldRow, onClose, commitElide, commitPaste],
  );

  /** "Ask this differently": the message comes back in the composer to be edited. */
  const openRevise = useCallback(
    async (entryId: string): Promise<void> => {
      if (!client) return;
      try {
        const result = await client.call('get_entry', { entry_id: entryId });
        const entry = readEntry((result.entry as Record<string, unknown>)['message']);
        const text = entry.kind === 'user' ? entry.blocks.map((b) => ('text' in b ? b.text : '')).join('') : '';
        setChooser({ kind: 'revise', entryId, text });
      } catch (raw) {
        setNotice(describe(raw));
      }
    },
    [client],
  );

  // ── the offer line ─────────────────────────────────────────────────────────

  const offer = useMemo<string>(() => {
    if (tree === null || cursor === null) return '';
    if (copied !== null && pasteRefusal(tree, copied, cursor) === null) {
      const count = subtreeOf(tree, copied).length;
      return `v: paste ${count} copied ${count === 1 ? 'entry' : 'entries'} under this node`;
    }
    if (elide === null) return '';
    if ('refusal' in elide) return marked.size > 0 ? `^E: ${elide.refusal}` : '';
    const moving = elide.movesCursor ? ', and move back to it' : '';
    return `^E: keep this span, drop the other ${elide.dropped} ${
      elide.dropped === 1 ? 'entry' : 'entries'
    }${moving}`;
  }, [tree, cursor, copied, elide, marked]);

  const marksLine = tree === null ? '' : marksSummary(tree, marked, hiddenRows);

  // ── render ─────────────────────────────────────────────────────────────────

  if (error !== null) {
    return (
      <section className="tau-panel tau-tree">
        <header className="tau-panel-head">
          <h2>Conversation tree</h2>
          <button className="tau-button tau-button-quiet" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="tau-notice tau-warn">{error}</p>
        <p className="tau-muted">
          The tree read arrived in tau 0.10.1 (protocol 1.5). An older tau answers METHOD_NOT_FOUND
          for it, and the browser cannot be drawn from anything else on the wire.
        </p>
      </section>
    );
  }

  return (
    <section className="tau-panel tau-tree" onKeyDown={onKey} tabIndex={-1} ref={list}>
      <header className="tau-panel-head">
        <h2>Conversation tree</h2>
        <span className="tau-muted">{tree === null ? 'Reading…' : `${tree.nodes.length} entries`}</span>
        <button className="tau-button tau-button-quiet" onClick={onClose}>
          Close
        </button>
      </header>

      {notice ? <p className="tau-notice tau-warn">{notice}</p> : null}

      <div className={`tau-tree-body${paneHidden ? ' tau-tree-body-wide' : ''}`}>
        <div className="tau-tree-rows" role="tree">
          {visible.map((row) => {
            const index = rows.indexOf(row);
            const shut = isShut(index);
            const zone = zoneOf(zones, row.node.entryId);
            const classes = [
              'tau-tree-row',
              row.node.entryId === cursor ? 'tau-tree-row-cursor' : '',
              zone === null ? '' : `tau-zone-${zone}`,
              hover.common.has(row.node.entryId) ? 'tau-hover-common' : '',
              hover.divergent.has(row.node.entryId) ? 'tau-hover-divergent' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={row.node.entryId}
                className={classes}
                role="treeitem"
                aria-selected={row.node.entryId === cursor}
                style={{ paddingLeft: `${row.depth * 1.2 + 0.4}rem` }}
                onClick={() => setCursor(row.node.entryId)}
                onMouseEnter={() => setHovered(row.node.entryId)}
                onMouseLeave={() => setHovered(null)}
              >
                <span
                  className="tau-tree-twist"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCursor(row.node.entryId);
                    foldRow(shut, index);
                  }}
                >
                  {row.hasChildren ? (shut ? '▸' : '▾') : ' '}
                </span>
                <span className={`tau-tree-tag tau-tag-${tagOf(row.node.kind, row.node.role)}`}>
                  {tagOf(row.node.kind, row.node.role)}:
                </span>
                <span className="tau-tree-preview">{row.node.preview || '—'}</span>
                {marked.has(row.node.entryId) ? <span className="tau-tree-mark">●</span> : null}
                {row.node.isCursor ? <span className="tau-tree-current">◀ current</span> : null}
              </div>
            );
          })}
        </div>

        {paneHidden ? (
          <button className="tau-tree-pane-marker" onClick={() => setPaneHidden(false)}>
            ▸ detail pane hidden — ctrl+D, or click here, to show it
          </button>
        ) : (
          <DetailPane client={client} tree={tree} entryId={cursor} />
        )}
      </div>

      <div className="tau-tree-readout">
        {marksLine ? <div>{marksLine}</div> : null}
        {offer ? <div className="tau-tree-offer">{offer}</div> : null}
        <div className="tau-tree-keys">{KEY_LINE}</div>
      </div>

      {chooser?.kind === 'branch' ? (
        <BranchChooser
          busy={busy}
          onCancel={() => setChooser(null)}
          onPick={(mode) => {
            if (mode === 'plain') void navigate(chooser.entryId, null, false);
            else if (mode === 'summarize') void navigate(chooser.entryId, null, true);
            else setChooser({ kind: 'instructions', entryId: chooser.entryId, draft: '' });
          }}
        />
      ) : null}

      {chooser?.kind === 'instructions' ? (
        <InstructionsDialog
          busy={busy}
          onCancel={() => setChooser(null)}
          onSubmit={(text) => void navigate(chooser.entryId, text, true)}
        />
      ) : null}

      {chooser?.kind === 'branchMode' ? (
        <BranchModeChooser
          busy={busy}
          count={marked.size}
          onCancel={() => setChooser(null)}
          onPick={(dropContext) => void commitBranch(dropContext)}
        />
      ) : null}

      {chooser?.kind === 'revise' ? (
        <ReviseDialog
          text={chooser.text}
          onCancel={() => setChooser(null)}
          onSubmit={() => {
            const parent = tree?.byId.get(chooser.entryId)?.parentId ?? null;
            if (parent === null) return;
            onRevise?.(chooser.text);
            void navigate(parent, null, false);
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------- detail pane */

/**
 * The pane beside the tree: what came before, the selected node, what came next.
 *
 * Three nodes, and it states what it is not drawing. A pane showing three boxes
 * without saying "12 earlier" implies a three-message conversation.
 *
 * The bodies come from `get_entry`, one call per node -- which is why `get_tree`
 * carries a one-line preview per row rather than a message: a browser should not
 * pull the bodies of rows it is not showing.
 */
function DetailPane({
  client,
  tree,
  entryId,
}: {
  client: TauClient | null;
  tree: Tree | null;
  entryId: string | null;
}): JSX.Element {
  const [bodies, setBodies] = useState<Record<string, Entry>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const around = useMemo(() => {
    if (tree === null || entryId === null) return { previous: null, next: null, laterSiblings: 0, earlier: 0 };
    const node = tree.byId.get(entryId);
    const children = tree.childrenOf.get(entryId) ?? [];
    const path = pathTo(tree, entryId);
    return {
      previous: node?.parentId ?? null,
      next: children[0] ?? null,
      laterSiblings: Math.max(children.length - 1, 0),
      earlier: Math.max(path.length - 2, 0),
    };
  }, [tree, entryId]);

  useEffect(() => {
    if (!client) return;
    const wanted = [around.previous, entryId, around.next].filter((id): id is string => id !== null);
    let cancelled = false;
    void Promise.all(
      wanted.map(async (id) => {
        const result = await client.call('get_entry', { entry_id: id });
        return [id, readEntry((result.entry as Record<string, unknown>)['message'])] as const;
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setBodies(Object.fromEntries(pairs));
        setFailed(null);
      })
      .catch((raw: unknown) => {
        if (!cancelled) setFailed(describe(raw));
      });
    return () => {
      cancelled = true;
    };
  }, [client, entryId, around.previous, around.next]);

  if (entryId === null) return <div className="tau-tree-pane tau-muted">Nothing selected.</div>;

  const box = (id: string | null, label: string): JSX.Element | null => {
    if (id === null) return null;
    const entry = bodies[id];
    return (
      <div className={`tau-tree-detail tau-tree-detail-${label}`}>
        <div className="tau-tree-detail-label">{label}</div>
        <pre className="tau-pre">{entry === undefined ? '…' : detailText(entry)}</pre>
      </div>
    );
  };

  return (
    <div className="tau-tree-pane">
      {failed ? <div className="tau-notice tau-warn">{failed}</div> : null}
      {around.earlier > 0 ? <div className="tau-muted">⋯ {around.earlier} earlier</div> : null}
      {box(around.previous, 'previous')}
      {box(entryId, 'selected')}
      {box(around.next, 'next')}
      {around.laterSiblings > 0 ? (
        <div className="tau-muted">
          ⋯ {around.laterSiblings} other {around.laterSiblings === 1 ? 'branch' : 'branches'} from here
        </div>
      ) : null}
    </div>
  );
}

/** One entry as text. A node with no message says which bookkeeping kind it is. */
function detailText(entry: Entry): string {
  switch (entry.kind) {
    case 'user':
    case 'assistant':
      return entry.blocks
        .map((block) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'thinking') return `[reasoning]\n${block.thinking}`;
          if (block.type === 'toolCall') return `[${block.name}] ${JSON.stringify(block.arguments)}`;
          return '[image]';
        })
        .join('\n\n');
    case 'toolResult':
      return entry.blocks.map((block) => ('text' in block ? block.text : '[block]')).join('\n');
    case 'system':
      return entry.text;
    default:
      return 'This entry carries no message — it is a record of a change to the conversation.';
  }
}

/* ----------------------------------------------------------------- dialogs */

function BranchChooser({
  busy,
  onPick,
  onCancel,
}: {
  busy: boolean;
  onPick: (mode: 'plain' | 'summarize' | 'instructions') => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="tau-dialog">
      <h3>Continue from this node</h3>
      <p className="tau-muted">
        What came after it stays in the tree as a sibling line. Nothing is deleted.
      </p>
      <div className="tau-dialog-row">
        <button className="tau-button" disabled={busy} onClick={() => onPick('plain')}>
          Branch here
        </button>
        <button className="tau-button" disabled={busy} onClick={() => onPick('summarize')}>
          Summarize the abandoned branch
        </button>
        <button className="tau-button" disabled={busy} onClick={() => onPick('instructions')}>
          Summarize with instructions…
        </button>
        <button className="tau-button tau-button-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="tau-muted">
        Summarizing makes a completion call, so it costs tokens and takes time that branching does not.
      </p>
    </div>
  );
}

function BranchModeChooser({
  busy,
  count,
  onPick,
  onCancel,
}: {
  busy: boolean;
  count: number;
  onPick: (dropContext: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="tau-dialog">
      <h3>
        Branch from {count} marked {count === 1 ? 'message' : 'messages'}
      </h3>
      <p className="tau-muted">
        Marks that already form an unbroken chain are used in place — same entries, same ids. Only
        the messages after the first gap are copied.
      </p>
      <div className="tau-dialog-row">
        <button className="tau-button" disabled={busy} onClick={() => onPick(false)}>
          Keep the context above them
        </button>
        <button className="tau-button" disabled={busy} onClick={() => onPick(true)}>
          Keep only the system prompt
        </button>
        <button className="tau-button tau-button-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function InstructionsDialog({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  return (
    <div className="tau-dialog">
      <h3>Instructions for the summarizer</h3>
      <textarea
        className="tau-input"
        rows={3}
        value={text}
        autoFocus
        placeholder="What the summary should focus on"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="tau-dialog-row">
        <button className="tau-button" disabled={busy} onClick={() => onSubmit(text)}>
          Summarize and branch
        </button>
        <button className="tau-button tau-button-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReviseDialog({
  text,
  onSubmit,
  onCancel,
}: {
  text: string;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="tau-dialog">
      <h3>Ask this differently</h3>
      <p className="tau-muted">
        Continuing below your own message would put two user turns in a row, which a conversation
        cannot have. The cursor moves to this message's parent and the text comes back in the
        composer; send it and you have a second branch beside the first, with the original still in
        the tree.
      </p>
      <pre className="tau-pre">{text}</pre>
      <div className="tau-dialog-row">
        <button className="tau-button" onClick={onSubmit}>
          Put it in the composer
        </button>
        <button className="tau-button tau-button-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
