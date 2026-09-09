import { useEffect, useState } from 'react';
import type { TauClient } from '@ffwf/tau-code-protocol';
import { enumerateDomain, offersPicker, type DomainValue, type FlowStep } from './flows.js';
import { describe } from './useTau.js';

/**
 * One step of a flow, asked.
 *
 * tau decides WHICH argument comes next and what values it takes; this decides
 * how to ask. That split is what lets an extension's `register_flow` command get
 * a rendered field here with no code written for it -- this component has never
 * heard of the command and does not need to.
 *
 * ## A richer control, never a poorer one
 *
 * `field_kind` says how tau would ask. A head may substitute something richer.
 * `session_id` and `message_id` both declare `text` and both have an enumerator,
 * so a text box would make the reader type an id they can only have got from a
 * list they were never shown -- `offersPicker` is where that judgment lives, and
 * this renders a picker for anything it says yes to.
 */
export interface FlowDialogProps {
  client: TauClient | null;
  step: FlowStep;
  onSubmit: (value: unknown) => void;
  onCancel: () => void;
}

export function FlowDialog({ client, step, onSubmit, onCancel }: FlowDialogProps): JSX.Element {
  const [options, setOptions] = useState<DomainValue[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');

  const picker = offersPicker(step.domain);

  useEffect(() => {
    if (!client || !picker) return;
    let cancelled = false;
    // A fixed `values` list is already in hand; only an enumerator costs a call.
    if (step.domain.values !== null) {
      setOptions(step.domain.values.map((value) => ({ value, label: value })));
      setTotal(step.domain.values.length);
      return;
    }
    void enumerateDomain(client, step.domain.name, { cursor: step.cursor })
      .then((listing) => {
        if (cancelled) return;
        setOptions(listing.values);
        setTotal(listing.total);
      })
      .catch((raw: unknown) => {
        // A domain that cannot be listed is a refusal, not a traceback, and not
        // a silently empty field either: an empty list would read as "this
        // argument has no legal value", which is a different statement.
        if (!cancelled) setError(describe(raw));
      });
    return () => {
      cancelled = true;
    };
  }, [client, picker, step.domain.name, step.domain.values, step.cursor]);

  const label = step.argument.description || step.argument.name;

  return (
    <section className="tau-dialog tau-flow-dialog">
      <h3>
        /{step.flow} — {label}
      </h3>
      {step.domain.description ? <p className="tau-muted">{step.domain.description}</p> : null}
      {error ? <p className="tau-notice tau-warn">{error}</p> : null}

      {step.domain.fieldKind === 'confirm' ? (
        <div className="tau-dialog-row">
          <button className="tau-button" onClick={() => onSubmit(true)}>
            Yes
          </button>
          <button className="tau-button" onClick={() => onSubmit(false)}>
            No
          </button>
          <button className="tau-button tau-button-quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : picker && error === null ? (
        <>
          {options === null ? (
            <p className="tau-muted">Reading the list…</p>
          ) : options.length === 0 ? (
            <p className="tau-notice tau-warn">
              tau lists no values for {step.domain.name}, so there is nothing this argument can be.
            </p>
          ) : (
            <ul className="tau-flow-options">
              {options.map((option) => (
                <li key={option.value}>
                  <button className="tau-row-button" onClick={() => onSubmit(option.value)}>
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {options !== null && total > options.length ? (
            <p className="tau-muted">
              Showing {options.length} of {total}. tau capped the listing.
            </p>
          ) : null}
          <div className="tau-dialog-row">
            <button className="tau-button tau-button-quiet" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            className="tau-input"
            autoFocus
            type={step.domain.fieldKind === 'number' ? 'number' : 'text'}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmit(coerce(step, text));
              if (event.key === 'Escape') onCancel();
            }}
          />
          <div className="tau-dialog-row">
            <button className="tau-button" onClick={() => onSubmit(coerce(step, text))}>
              {step.argument.required ? 'Continue' : 'Continue (optional)'}
            </button>
            <button className="tau-button tau-button-quiet" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The typed value, in the type the domain takes.
 *
 * An empty answer is the field's VALUE, not a cancellation. Cancel is its own
 * button, and treating a blank box as one would throw away every field already
 * filled in a multi-step flow.
 */
function coerce(step: FlowStep, text: string): unknown {
  if (step.domain.fieldKind !== 'number') return text;
  if (text.trim() === '') return 0;
  const parsed = Number(text);
  return Number.isNaN(parsed) ? text : parsed;
}
