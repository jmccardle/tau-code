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
  /** The line that was carried out, to clear from the box once it has gone (not if it was edited). */
  const [sent, setSent] = useState<string | null>(null);
  const clear = (line: string | null): void => {
    if (line !== null) setText((now) => (now.trim() === line ? '' : now));
  };

  /** Do what the plan says; true once it is done, false while a form is waiting for it. */
  const carryOut = async (plan: LinePlan): Promise<boolean> => {
    switch (plan.kind) {
      case 'send':
        await call('send', { cursor, text: plan.text });
        if (plan.warning) note(plan.warning);
        return true;
      case 'run': {
        const result = await call('run', { cursor, command: plan.command, args: plan.args });
        note(result === null ? `/${plan.command} done` : `/${plan.command}: ${result}`);
        return true;
      }
      case 'configure':
        await call('configure', { cursor, extension: plan.extension, values: plan.values, save: plan.save });
        note(`/config ${plan.extension}: set${plan.save ? ' and saved' : ''}`);
        return true;
      case 'ask':
      case 'options':
        setPending(plan);
        return false;
    }
  };

  const submit = async (): Promise<void> => {
    const line = text.trim();
    if (!line) return;
    setWorking(true);
    setError(null);
    setChoices([]);
    try {
      // The line stays in the box until it has gone: a refused or failed send keeps what was
      // typed, and so does a form that is cancelled.
      setSent(line);
      if (await carryOut(await planLine(call, cursor, line))) clear(line);
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
          onDone={(done) => {
            setPending(null);
            if (done) clear(sent);
          }}
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
          placeholder="a message, or / for a command (tab completes). enter sends, shift+enter is a new line"
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
          send
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
  /** The form closed: `done` once its action succeeded, false when cancelled. */
  onDone: (done: boolean) => void;
  carryOut: (plan: LinePlan) => Promise<boolean>;
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
          submitLabel="set"
          extra={
            <label className="tau-choice">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              also save to my config file
            </label>
          }
          onSubmit={async (values) => {
            await carryOut({ kind: 'configure', extension: pending.extension, values: values as Record<string, unknown>, save });
            onDone(true);
          }}
          secondary={{ label: 'cancel', onClick: () => onDone(false) }}
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
        submitLabel="run"
        onSubmit={async (args) => {
          const values = args as Record<string, unknown>;
          // `/config` with no extension: once one is chosen, it is that extension's options form.
          if (pending.form.name === 'config' && !pending.form.extension && typeof values['extension'] === 'string') {
            // The line is not done yet: it is waiting on the options form now.
            onDone(false);
            await carryOut(await planLine(call, cursor, `/config ${values['extension']}`));
            return;
          }
          await carryOut({ kind: 'run', command: pending.command, args: values });
          onDone(true);
        }}
        secondary={{ label: 'cancel', onClick: () => onDone(false) }}
      />
    </div>
  );
}
