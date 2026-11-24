import { useEffect, useMemo, useState } from 'react';
import type { SessionModel } from '@ffwf/tau-code-protocol';
import { attempt } from './cursors.js';
import type { Call } from './line.js';
import { treeLines } from './tree.js';

export interface TreePanelProps {
  model: SessionModel;
  /** Whether the whole tree has been read. */
  loaded: boolean;
  /** Read it (`SessionLink.loadTree`). */
  load: () => Promise<void>;
  focus: number | null;
  onFocus: (cursor: number) => void;
  call: Call;
  report: (message: string | null) => void;
}

/**
 * The session's tree: every node, branches indented, each open cursor marked where it is. Pick a
 * node to move the followed cursor there (`go_to`: a branch, if it is not on the cursor's line),
 * or to open another cursor at it. The followed cursor's labels are set and removed here.
 */
export function TreePanel({ model, loaded, load, focus, onFocus, call, report }: TreePanelProps): JSX.Element {
  const [picked, setPicked] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!loaded) attempt(report, load);
  }, [loaded, load, report]);

  const lines = useMemo(() => treeLines(model), [model, model.version]);
  const followed = focus === null ? undefined : model.views.get(focus);
  const onLine = useMemo(() => new Set((followed && model.walk(followed.at)?.map((n) => n.id)) ?? []), [followed, model, model.version]);
  const cursorsAt = new Map<number, number[]>();
  for (const view of model.openCursors()) cursorsAt.set(view.at, [...(cursorsAt.get(view.at) ?? []), view.cursor]);

  return (
    <div className="tau-tree" data-testid="tree">
      <div className="tau-tree-actions">
        {followed ? (
          <>
            <span className="tau-hint">cursor #{followed.cursor}</span>
            {model.labelsOf(followed.cursor).map((name) => (
              <span key={name} className="tau-chip">
                {name}
                <button
                  type="button"
                  className="tau-link"
                  title={`Remove the label ${name}`}
                  onClick={() => attempt(report, () => call('remove_label', { label: name }))}
                >
                  ×
                </button>
              </span>
            ))}
            <form
              className="tau-inline"
              onSubmit={(e) => {
                e.preventDefault();
                const name = label.trim();
                if (!name) return;
                attempt(report, async () => {
                  await call('set_label', { cursor: followed.cursor, label: name });
                  setLabel('');
                });
              }}
            >
              <input aria-label="label" placeholder="label" value={label} onChange={(e) => setLabel(e.target.value)} />
              <button type="submit">Label</button>
            </form>
          </>
        ) : (
          <span className="tau-hint">no cursor followed</span>
        )}
      </div>
      {picked !== null && (
        <div className="tau-tree-actions">
          <span>node #{picked}</span>
          <button
            type="button"
            disabled={!followed}
            onClick={() =>
              followed && attempt(report, async () => {
                await call('go_to', { cursor: followed.cursor, to: picked });
                setPicked(null);
              })
            }
          >
            Go to (cursor #{focus})
          </button>
          <button
            type="button"
            onClick={() =>
              attempt(report, async () => {
                onFocus(await call('open', { at: picked }));
                setPicked(null);
              })
            }
          >
            Open a cursor here
          </button>
          <button type="button" className="tau-link" onClick={() => setPicked(null)}>
            cancel
          </button>
        </div>
      )}
      {!loaded && <div className="tau-hint">reading the tree…</div>}
      <div className="tau-tree-lines">
        {lines.map(({ node, depth, summary, children }) => (
          <button
            key={node.id}
            type="button"
            data-node={node.id}
            className={`tau-tree-line${onLine.has(node.id) ? ' tau-on-line' : ''}${picked === node.id ? ' tau-picked' : ''}`}
            style={{ paddingLeft: `${0.5 + depth * 1.2}em` }}
            onClick={() => setPicked(node.id)}
          >
            <span className="tau-row-node">#{node.id}</span> {children > 1 && <span className="tau-hint">⑂</span>}{' '}
            {summary}
            {(cursorsAt.get(node.id) ?? []).map((cursor) => (
              <span key={cursor} className="tau-badge">
                #{cursor} {model.labelsOf(cursor).join(' ')}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}
