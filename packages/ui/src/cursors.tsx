import { useState } from 'react';
import { endingText, isFrontend, itemText } from '@ffwf/tau-code-protocol';
import type { CursorView, SessionModel } from '@ffwf/tau-code-protocol';
import type { Call } from './line.js';

/** Run an action, reporting a failure with `report`; τ's sentence is the message. */
export function attempt(report: (message: string | null) => void, action: () => Promise<unknown>): void {
  report(null);
  action().catch((error: unknown) => report(error instanceof Error ? error.message : String(error)));
}

export interface CursorTabsProps {
  model: SessionModel;
  focus: number | null;
  onFocus: (cursor: number) => void;
  call: Call;
  report: (message: string | null) => void;
}

/**
 * The cursor switcher: a tab per open cursor (its labels, busy, asking, how its last step ended),
 * a button to open another at the followed cursor's node, and the closed cursors to reopen.
 */
export function CursorTabs({ model, focus, onFocus, call, report }: CursorTabsProps): JSX.Element {
  const open = model.openCursors();
  const followed = focus === null ? undefined : model.views.get(focus);
  const [showClosed, setShowClosed] = useState(false);
  const closed = [...model.gone].sort((a, b) => a[0] - b[0]);
  return (
    <div className="tau-cursors" role="tablist">
      {open.map((view) => (
        <CursorTab
          key={view.cursor}
          view={view}
          labels={model.labelsOf(view.cursor)}
          selected={view.cursor === focus}
          onSelect={() => onFocus(view.cursor)}
          onClose={() => attempt(report, () => call('close_cursor', { cursor: view.cursor }))}
        />
      ))}
      <button
        type="button"
        className="tau-icon-button"
        title="Open another cursor here (a branch from this node)"
        disabled={!followed}
        onClick={() =>
          followed && attempt(report, async () => onFocus(await call('open', { at: followed.at })))
        }
      >
        +
      </button>
      {closed.length > 0 && (
        <span className="tau-closed">
          <button type="button" className="tau-link" onClick={() => setShowClosed(!showClosed)}>
            {closed.length} closed
          </button>
          {showClosed &&
            closed.map(([cursor, at]) => (
              <button
                key={cursor}
                type="button"
                className="tau-chip"
                title={`Reopen cursor ${cursor} at node ${at}, moving its labels`}
                onClick={() => attempt(report, async () => onFocus(await call('reopen', { cursor })))}
              >
                reopen #{cursor} {model.labelsOf(cursor).join(' ')}
              </button>
            ))}
        </span>
      )}
    </div>
  );
}

function CursorTab(props: {
  view: CursorView;
  labels: string[];
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}): JSX.Element {
  const { view, labels, selected, onSelect, onClose } = props;
  const state = view.busy ? 'busy' : view.ending === null ? 'rest' : endingClass(view.ending);
  return (
    <span className={`tau-tab${selected ? ' tau-selected' : ''}`} role="tab" aria-selected={selected}>
      <button type="button" className="tau-tab-main" onClick={onSelect} data-cursor={view.cursor}>
        <span className={`tau-dot tau-dot-${state}`} />#{view.cursor}
        {labels.length > 0 && <span className="tau-tab-labels"> {labels.join(' ')}</span>}
        {view.questions.length > 0 && (
          <span className="tau-badge" title="open questions">
            ?{view.questions.length}
          </span>
        )}
      </button>
      <button type="button" className="tau-tab-close" title={`Close cursor ${view.cursor}`} onClick={onClose}>
        ×
      </button>
    </span>
  );
}

function endingClass(ending: NonNullable<CursorView['ending']>): string {
  if (ending === 'Done') return 'done';
  if (ending === 'Aborted') return 'aborted';
  return 'Halted' in ending ? 'halted' : 'failed';
}

export interface StepControlsProps {
  view: CursorView;
  call: Call;
  report: (message: string | null) => void;
}

/**
 * The step debugger of protocol 2 is auto-step: with it off a cursor takes one step when told
 * (`step`); `abort` stops a busy one. The indicator says which, and how the last step ended.
 */
export function StepControls({ view, call, report }: StepControlsProps): JSX.Element {
  const cursor = view.cursor;
  return (
    <div className="tau-step">
      <label className="tau-choice" title="Auto-step: the cursor steps on its own while it has input">
        <input
          type="checkbox"
          checked={view.auto}
          onChange={(e) => attempt(report, () => call('set_auto', { cursor, on: e.target.checked }))}
        />
        auto-step {view.auto ? 'on' : 'off'}
      </label>
      <button type="button" disabled={view.busy} onClick={() => attempt(report, () => call('step', { cursor }))}>
        Step
      </button>
      <button type="button" disabled={!view.busy} onClick={() => attempt(report, () => call('abort', { cursor }))}>
        Abort
      </button>
      <span className="tau-step-state" data-testid="step-state">
        {view.busy ? 'working' : 'at rest'}
        {view.ending !== null && !view.busy && ` · ${endingText(view.ending)}`}
      </span>
      {view.hook_error && (
        <span className="tau-error">
          {view.hook_error.extension} {view.hook_error.point}: {view.hook_error.error}
        </span>
      )}
    </div>
  );
}

export interface ItemsProps {
  view: CursorView;
  client: string;
  call: Call;
  report: (message: string | null) => void;
}

/** The cursor's pending input (its scratchpad): this client's own can be taken back. */
export function Items({ view, client, call, report }: ItemsProps): JSX.Element | null {
  if (view.items.length === 0) return null;
  return (
    <div className="tau-items">
      <div className="tau-hint">waiting to be delivered</div>
      {view.items.map((item) => {
        const { by, text, author } = itemText(item.data);
        const mine = author !== null && isFrontend(author, client);
        return (
          <div key={item.id} className="tau-item">
            <span className="tau-hint">{mine ? 'you' : by}:</span> <span className="tau-item-text">{text}</span>
            {mine && (
              <button
                type="button"
                className="tau-link"
                onClick={() => attempt(report, () => call('remove_item', { cursor: view.cursor, item: item.id }))}
              >
                take back
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
