import { useEffect, useState } from 'react';
import type { TauClient } from '@ffwf/tau-code-protocol';
import {
  answerRequest,
  initialValues,
  refusalReason,
  type AskField,
  type ExtensionRequest,
} from './requests.js';
import { describe } from './useTau.js';

/**
 * The extension request, drawn.
 *
 * Two states reach the screen and they want opposite treatment. A LOCK WITH AN
 * ASK is a form: the session is stopped and there is something to fill in, so
 * the panel is the way forward and it opens where the reader is looking. A BARE
 * LOCK has nothing to answer, so it states who stopped the session and every way
 * out, and drawing a form for it would be a form with no submit.
 *
 * Drawing a request and opening its ask are ONE step here. The TUI draws a row
 * in the transcript and opens the ask when it is clicked; a row is clickable and
 * a panel is what a request without one would need. So this is the panel.
 */
export interface RequestPanelProps {
  client: TauClient | null;
  request: ExtensionRequest;
  /** Re-read the transcript and the request after the lock is released. */
  onAnswered: () => Promise<void> | void;
  /** Leave it for later. The request comes back at the next cursor move. */
  onDismiss: () => void;
}

export function RequestPanel({ client, request, onAnswered, onDismiss }: RequestPanelProps): JSX.Element {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    request.ask === null ? {} : initialValues(request.ask),
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(request.ask === null ? {} : initialValues(request.ask));
    setError(null);
    setWarning(null);
  }, [request.entryId, request.ask]);

  const press = async (action: string): Promise<void> => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const result = await answerRequest(client, request, action, values);
      if (!result.handled) {
        setWarning(
          `${request.extensionName} is not loaded, so nothing ran — the request is answered ` +
            `and the session is unlocked.`,
        );
      }
      await onAnswered();
    } catch (raw) {
      // tau validated the values against the ask's own declared fields. Nothing
      // was appended and the lock is exactly as it was, so the form stays up
      // with what was typed still in it.
      setError(describe(raw));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`tau-panel tau-request${request.lock ? ' tau-request-locked' : ''}`}>
      <header className="tau-panel-head">
        <h2>{request.label}</h2>
        <button className="tau-button tau-button-quiet" onClick={onDismiss}>
          Later
        </button>
      </header>

      {request.ask === null ? (
        <p className="tau-notice tau-warn">{refusalReason(request)}</p>
      ) : (
        <>
          <p className="tau-request-sentence">{request.sentence}</p>
          {request.ask.title ? <h3>{request.ask.title}</h3> : null}
          {request.ask.body ? <AskBody body={request.ask.body} /> : null}
          {error ? <p className="tau-notice tau-warn">{error}</p> : null}
          {warning ? <p className="tau-notice">{warning}</p> : null}
          <div className="tau-request-fields">
            {request.ask.fields.map((field) => (
              <Field
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={(value) => setValues((previous) => ({ ...previous, [field.name]: value }))}
              />
            ))}
          </div>
          <div className="tau-dialog-row">
            {request.ask.actions.map((action) => (
              <button
                key={action.label}
                className="tau-button"
                disabled={busy || !client}
                onClick={() => void press(action.label)}
              >
                {action.label}
              </button>
            ))}
          </div>
          {request.lock ? (
            <p className="tau-muted">
              Every prompt is refused until this is answered. Answering releases the lock; so does
              branching past it in the conversation tree.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The ask's optional body: text, a list, or a table. The same three a panel takes. */
function AskBody({ body }: { body: Record<string, unknown> }): JSX.Element | null {
  if (typeof body['text'] === 'string') return <p className="tau-text">{body['text']}</p>;
  if (Array.isArray(body['list'])) {
    return (
      <ul className="tau-request-list">
        {body['list'].map((item, index) => (
          <li key={index}>{String(item)}</li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(body['table'])) {
    return (
      <table className="tau-request-table">
        <tbody>
          {body['table'].map((row, index) => (
            <tr key={index}>
              {(Array.isArray(row) ? row : [row]).map((cell, column) => (
                <td key={column}>{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return null;
}

/**
 * One field, by its declared kind.
 *
 * A kind this head does not know reaches `readField` as a TypeError rather than
 * arriving here as a blank space -- the check is up there so the whole panel
 * says it cannot draw the form, instead of drawing one that silently omits a
 * field the extension is waiting on.
 */
function Field({
  field,
  value,
  onChange,
}: {
  field: AskField;
  value: unknown;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const id = `tau-ask-${field.name}`;
  return (
    <label className="tau-request-field" htmlFor={id}>
      <span className="tau-request-label">{field.label}</span>
      {field.kind === 'confirm' ? (
        <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      ) : field.kind === 'number' ? (
        <input
          id={id}
          type="number"
          className="tau-input"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      ) : field.kind === 'select' ? (
        <select id={id} className="tau-input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.kind === 'multiselect' ? (
        <select
          id={id}
          className="tau-input"
          multiple
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={(e) => onChange([...e.target.selectedOptions].map((option) => option.value))}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          className="tau-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
