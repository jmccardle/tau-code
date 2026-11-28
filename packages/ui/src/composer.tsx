import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import type { Completion, NoticeLevel } from '@ffwf/tau-code-protocol';
import {
  attach,
  detach,
  filesOf,
  IMAGE_ACCEPT,
  sendImages,
  sizeText,
  trayProblem,
  type Attached,
  type FileLike,
} from './attachments.js';
import { rememberImage } from './images.js';
import { complete, planLine, type Call, type LinePlan } from './line.js';
import { SchemaForm } from './schema-form.js';
import type { Schema } from './schema.js';

export interface ComposerProps {
  cursor: number;
  call: Call;
  /** Show the result of a command, or another line of this client's own. */
  note: (text: string, level?: NoticeLevel) => void;
  /**
   * How many `Commands` events the session has sent (`SessionModel.commandsVersion`). An options
   * form held open when it moves is stale (D32), and is read again.
   */
  commandsVersion: number;
  /**
   * Whether the cursor's model takes images: `ModelInfo.images !== null` (D32 section 8). True
   * while the catalog has no entry for it (not read yet); the server refuses an image it cannot
   * take either way.
   */
  takesImages: boolean;
}

/** A form the composer is waiting on: a command's missing arguments, or an extension's options. */
type Pending = Extract<LinePlan, { kind: 'ask' } | { kind: 'options' }>;

/** Whether a drag carries files (not text, not an editor's URIs). */
function carriesFiles(event: globalThis.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * The line to type: input is `send`, a `/command` is read by the server (`parse_line`) and then
 * run, configured, or shown as a form for what it is missing. Tab asks the server what could finish
 * the last word (`complete_line`).
 *
 * Images (protocol 3, τ's D31) wait in a tray above the line, picked with the attach button,
 * pasted, or dropped anywhere on the page, and go with the next plain message, or alone. A refused send keeps both the
 * tray and the line.
 */
export function Composer({ cursor, call, note, commandsVersion, takesImages }: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Completion[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [tray, setTray] = useState<Attached[]>([]);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  /** The tray, for reads made after an `await` (a closure's `tray` is the render's). */
  const trayRef = useRef<Attached[]>(tray);
  /** The line that was carried out, to clear from the box once it has gone (not if it was edited). */
  const [sent, setSent] = useState<string | null>(null);
  const clear = (line: string | null): void => {
    if (line !== null) setText((now) => (now.trim() === line ? '' : now));
  };

  // `Commands` says the options forms held are stale: read the open one again. The form is
  // replaced under the person's hands only when τ says it changed.
  const versionSeen = useRef(commandsVersion);
  useEffect(() => {
    if (commandsVersion === versionSeen.current) return;
    versionSeen.current = commandsVersion;
    if (pending?.kind !== 'options') return;
    const { extension } = pending;
    call('options', { cursor, extension }).then(
      (form) => setPending((now) => (now?.kind === 'options' && now.extension === extension ? { ...now, form } : now)),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, [commandsVersion, pending, call, cursor]);

  /** Read files into the tray; say why any were not added. */
  const add = async (files: readonly FileLike[]): Promise<void> => {
    if (files.length === 0) return;
    if (!takesImages) {
      setError('this model takes no images');
      return;
    }
    setReading(true);
    setError(null);
    try {
      // Read against the tray as it is now; a second paste while this one reads waits its turn.
      const { tray: next, problems } = await attach(trayRef.current, files);
      trayRef.current = next;
      setTray(next);
      if (problems.length) setError(problems.join('\n'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setReading(false);
    }
  };
  const remove = (id: number): void => {
    trayRef.current = detach(trayRef.current, id);
    setTray(trayRef.current);
  };

  /** Do what the plan says; true once it is done, false while a form is waiting for it. */
  const carryOut = async (plan: LinePlan): Promise<boolean> => {
    switch (plan.kind) {
      case 'send':
        await call('send', { cursor, text: plan.text });
        if (plan.warning) note(plan.warning, 'warning');
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

  /** Send `line` with the tray's images (a plain `send`, never a command); the rest stay. */
  const sendTray = async (line: string, images: readonly Attached[]): Promise<void> => {
    const gone = await sendImages(call, cursor, line, images, rememberImage);
    trayRef.current = trayRef.current.filter((image) => !gone.has(image.id));
    setTray(trayRef.current);
  };

  const submit = async (): Promise<void> => {
    const line = text.trim();
    const images = trayRef.current;
    if (!line && images.length === 0) return;
    setChoices([]);
    const problem = trayProblem(line, images);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setWorking(true);
    setError(null);
    try {
      // The line and the tray stay until they have gone: a refused or failed send keeps what was
      // typed and attached, and so does a form that is cancelled.
      setSent(line);
      if (images.length > 0) {
        await sendTray(line, images);
        clear(line);
      } else if (await carryOut(await planLine(call, cursor, line))) clear(line);
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
        setText(complete(text, (found[0] as Completion).value) + ' ');
        setChoices([]);
      } else setChoices(found);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const onPaste = (e: ClipboardEvent): void => {
    const files = filesOf(e.clipboardData);
    if (files.length === 0) return; // text: the box takes it as ever
    e.preventDefault();
    void add(files);
  };
  // A drop of files anywhere on the page attaches them: the composer is the one place they can go,
  // and a browser would otherwise open a missed drop as a page of its own, leaving the session.
  // A drag of text or an editor's URIs is left alone, so the box takes it as it always did.
  const addLatest = useRef(add);
  addLatest.current = add;
  useEffect(() => {
    const over = (e: globalThis.DragEvent): void => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };
    const leave = (e: globalThis.DragEvent): void => {
      if (e.relatedTarget === null) setDragging(false); // left the page
    };
    const drop = (e: globalThis.DragEvent): void => {
      setDragging(false);
      const files = filesOf(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      void addLatest.current(files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const canSend = !working && !reading && (text.trim() !== '' || tray.length > 0);
  return (
    <div className={`tau-composer${dragging ? ' tau-dropping' : ''}`}>
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
              key={choice.value}
              type="button"
              role="option"
              aria-selected={false}
              className="tau-chip"
              onClick={() => {
                setText(complete(text, choice.value) + ' ');
                setChoices([]);
              }}
            >
              {choice.label ?? choice.value}
              {choice.detail && <span className="tau-chip-detail">{choice.detail}</span>}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="tau-error" role="alert">
          {error}
        </div>
      )}
      {(tray.length > 0 || reading) && (
        <ul className="tau-tray" aria-label="attached images" data-testid="tray">
          {tray.map((image) => (
            <li key={image.id} className="tau-tray-item" title={`${image.name}: ${image.mime}, ${sizeText(image.bytes)}`}>
              <img className="tau-thumb" src={image.url} alt={image.name} />
              <span className="tau-tray-name">{image.name}</span>
              <button
                type="button"
                className="tau-tray-remove"
                aria-label={`remove ${image.name}`}
                title={`remove ${image.name}`}
                onClick={() => remove(image.id)}
              >
                ✕
              </button>
            </li>
          ))}
          {reading && <li className="tau-hint">reading…</li>}
        </ul>
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
          placeholder="a message, or / for a command (tab completes). enter sends, shift+enter is a new line. paste or drop images"
          onChange={(e) => {
            setText(e.target.value);
            if (choices.length) setChoices([]);
          }}
          onPaste={onPaste}
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
        <input
          ref={picker}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          data-testid="image-picker"
          onChange={(e) => {
            const files = filesOf(e.currentTarget);
            e.currentTarget.value = ''; // the same file may be picked again after a remove
            void add(files);
          }}
        />
        <button
          type="button"
          className="tau-attach"
          aria-label="attach images"
          title={takesImages ? 'attach images: png, jpeg, gif or webp' : 'this model takes no images'}
          disabled={!takesImages}
          onClick={() => picker.current?.click()}
        >
          attach
        </button>
        <button type="submit" disabled={!canSend}>
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
  note: (text: string, level?: NoticeLevel) => void;
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
