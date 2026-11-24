import { useState } from 'react';
import { complete, planLine, type Call, type LinePlan } from './line.js';
import { SchemaForm } from './schema-form.js';
import type { Schema } from './schema.js';

export interface ComposerProps {
  cursor: number;
  call: Call;
  /** Show the result of a command, or another line of this client's own. */
  note: (text: string) => void;
}

/** A form the composer is waiting on: a command's missing arguments, or an extension's options. */
type Pending = Extract<LinePlan, { kind: 'ask' } | { kind: 'options' }>;

/**
 * The line to type: input is `send`, a `/command` is read by the server (`parse_line`) and then
 * run, configured, or shown as a form for what it is missing. Tab asks the server what could finish
 * the last word (`complete_line`).
 */
export function Composer({ cursor, call, note }: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);

  const carryOut = async (plan: LinePlan): Promise<void> => {
    switch (plan.kind) {
      case 'send':
        await call('send', { cursor, text: plan.text });
        return;
      case 'run': {
        const result = await call('run', { cursor, command: plan.command, args: plan.args });
        note(result === null ? `/${plan.command} done` : `/${plan.command}: ${result}`);
        return;
      }
      case 'configure':
        await call('configure', { cursor, extension: plan.extension, values: plan.values, save: plan.save });
        note(`/config ${plan.extension}: set${plan.save ? ' and saved' : ''}`);
        return;
      case 'ask':
      case 'options':
        setPending(plan);
        return;
    }
  };

  const submit = async (): Promise<void> => {
    const line = text.trim();
    if (!line) return;
    setWorking(true);
    setError(null);
    setChoices([]);
    try {
      const plan = await planLine(call, cursor, line);
      setText('');
      await carryOut(plan);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setWorking(false);
    }
  };

  const completeLine = async (): Promise<void> => {
    try {
      const found = await call('complete_line', { cursor, line: text });
      if (found.length === 1) {
        setText(complete(text, found[0] as string) + ' ');
        setChoices([]);
      } else setChoices(found);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <div className="tau-composer">
      {pending && (
        <PendingForm
          pending={pending}
          cursor={cursor}
          call={call}
          note={note}
          onDone={() => setPending(null)}
          carryOut={carryOut}
        />
      )}
      {choices.length > 0 && (
        <div className="tau-completions" role="listbox">
          {choices.map((choice) => (
            <button
              key={choice}
              type="button"
              role="option"
              aria-selected={false}
              className="tau-chip"
              onClick={() => {
                setText(complete(text, choice) + ' ');
                setChoices([]);
              }}
            >
              {choice}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="tau-error" role="alert">
          {error}
        </div>
      )}
      <form
        className="tau-composer-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="message"
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          value={text}
          placeholder="Type a message, or / for a command (Tab completes). Enter sends; Shift+Enter is a new line."
          onChange={(e) => {
            setText(e.target.value);
            if (choices.length) setChoices([]);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Tab' && text.startsWith('/')) {
              e.preventDefault();
              void completeLine();
            } else if (e.key === 'Escape') {
              setChoices([]);
            }
          }}
        />
        <button type="submit" disabled={working || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function PendingForm(props: {
  pending: Pending;
  cursor: number;
  call: Call;
  note: (text: string) => void;
  onDone: () => void;
  carryOut: (plan: LinePlan) => Promise<void>;
}): JSX.Element {
  const { pending, cursor, call, onDone, carryOut } = props;
  const [save, setSave] = useState(pending.kind === 'options' ? pending.save : false);
  if (pending.kind === 'options') {
    return (
      <div className="tau-dialog">
        <SchemaForm
          idPrefix="options"
          title={`/config ${pending.extension}`}
          text={pending.form.description}
          schema={pending.form.schema as Schema}
          submitLabel="Set"
          extra={
            <label className="tau-choice">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              also save to my config file
            </label>
          }
          onSubmit={async (values) => {
            await carryOut({ kind: 'configure', extension: pending.extension, values: values as Record<string, unknown>, save });
            onDone();
          }}
          secondary={{ label: 'Cancel', onClick: onDone }}
        />
      </div>
    );
  }
  return (
    <div className="tau-dialog">
      <SchemaForm
        idPrefix="args"
        title={`/${pending.command}`}
        text={`${pending.form.description}${pending.missing.length ? ` (missing: ${pending.missing.join(', ')})` : ''}`}
        schema={pending.form.schema as Schema}
        start={pending.args}
        submitLabel="Run"
        onSubmit={async (args) => {
          const values = args as Record<string, unknown>;
          // `/config` with no extension: once one is chosen, it is that extension's options form.
          if (pending.form.name === 'config' && !pending.form.extension && typeof values['extension'] === 'string') {
            onDone();
            await carryOut(await planLine(call, cursor, `/config ${values['extension']}`));
            return;
          }
          await carryOut({ kind: 'run', command: pending.command, args: values });
          onDone();
        }}
        secondary={{ label: 'Cancel', onClick: onDone }}
      />
    </div>
  );
}
