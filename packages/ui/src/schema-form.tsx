import { useState } from 'react';
import { editorOf, initial, typeHint, type Schema } from './schema.js';

/** What a JSON field holds while its text does not parse. */
export const UNPARSED = Symbol('unparsed');

/** The first field whose JSON text does not parse, as a path, or null. */
export function unparsed(value: unknown, path = 'the value'): string | null {
  if (value === UNPARSED) return path;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) {
      const found = unparsed(inner, key);
      if (found) return found;
    }
  }
  return null;
}

interface FieldProps {
  schema: Schema;
  root: Schema;
  value: unknown;
  onChange: (value: unknown) => void;
  /** For a label's `htmlFor` and test hooks. */
  id: string;
}

/** One value's editor, chosen from its schema (`editorOf`). */
export function SchemaField({ schema, root, value, onChange, id }: FieldProps): JSX.Element {
  const editor = editorOf(schema, root);
  switch (editor.kind) {
    case 'choice':
      return (
        <div className="tau-choices" role="radiogroup" id={id}>
          {editor.options.map((option, i) => (
            <label key={i} className="tau-choice">
              <input
                type="radio"
                name={id}
                checked={JSON.stringify(value) === JSON.stringify(option)}
                onChange={() => onChange(option)}
              />
              {typeof option === 'string' ? option : JSON.stringify(option)}
            </label>
          ))}
        </div>
      );
    case 'boolean':
      return <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'integer':
    case 'number':
      return (
        <input
          id={id}
          type="number"
          step={editor.kind === 'integer' ? 1 : 'any'}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'string':
      return (
        <input
          id={id}
          type="text"
          placeholder={editor.format ?? ''}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'optional': {
      const none = value === null || value === undefined;
      return (
        <div className="tau-optional">
          <label className="tau-choice">
            <input
              type="checkbox"
              checked={none}
              onChange={(e) => onChange(e.target.checked ? null : (initial(editor.inner, root) ?? ''))}
            />
            none
          </label>
          {!none && <SchemaField schema={editor.inner} root={root} value={value} onChange={onChange} id={`${id}-value`} />}
        </div>
      );
    }
    case 'object': {
      const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
      return (
        <div className="tau-fields" id={id}>
          {editor.fields.map((field) => {
            const fieldId = `${id}-${field.name}`;
            const description = (field.schema['description'] as string | undefined) ?? null;
            return (
              <div key={field.name} className="tau-field">
                <label htmlFor={fieldId}>
                  {field.name}
                  {field.required && <span className="tau-required"> *</span>}
                  <span className="tau-hint"> {typeHint(field.schema, root)}</span>
                </label>
                {description && <div className="tau-hint">{description}</div>}
                <SchemaField
                  schema={field.schema}
                  root={root}
                  value={record[field.name]}
                  id={fieldId}
                  onChange={(inner) => {
                    const next = { ...record };
                    if (inner === undefined) delete next[field.name];
                    else next[field.name] = inner;
                    onChange(next);
                  }}
                />
              </div>
            );
          })}
        </div>
      );
    }
    case 'json':
      return <JsonField id={id} value={value} onChange={onChange} />;
  }
}

/** A value with no editor of its own: typed as JSON, parsed as it is typed. */
function JsonField({ id, value, onChange }: { id: string; value: unknown; onChange: (value: unknown) => void }): JSX.Element {
  const [text, setText] = useState(() => (value === undefined || value === UNPARSED ? '' : JSON.stringify(value)));
  const bad = value === UNPARSED;
  return (
    <div className="tau-json">
      <textarea
        id={id}
        rows={3}
        value={text}
        placeholder="JSON"
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') return onChange(undefined);
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            onChange(UNPARSED);
          }
        }}
      />
      <div className={bad ? 'tau-error' : 'tau-hint'}>{bad ? 'not JSON yet' : 'JSON'}</div>
    </div>
  );
}

export interface SchemaFormProps {
  title: string;
  /** What is asked, in a sentence; τ's text. */
  text?: string;
  schema: Schema;
  /** The starting value; the schema's defaults when left out. */
  start?: unknown;
  submitLabel: string;
  /** Resolves when done; a throw is shown, and the values typed are kept. */
  onSubmit: (value: unknown) => Promise<void>;
  /** A second action (decline, cancel). */
  secondary?: { label: string; onClick: () => Promise<void> | void };
  /** Shown above the buttons; an `extra` control (save to config). */
  extra?: JSX.Element;
  idPrefix: string;
}

/** A form for one value: a question's answer, a command's arguments, an extension's options. */
export function SchemaForm(props: SchemaFormProps): JSX.Element {
  const { title, text, schema, submitLabel, onSubmit, secondary, extra, idPrefix } = props;
  const [value, setValue] = useState<unknown>(() => (props.start !== undefined ? props.start : initial(schema, schema)));
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const act = async (action: () => Promise<void> | void): Promise<void> => {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <form
      className="tau-form"
      onSubmit={(e) => {
        e.preventDefault();
        const bad = unparsed(value);
        if (bad) {
          setError(`${bad}: the JSON does not parse`);
          return;
        }
        void act(() => onSubmit(value));
      }}
    >
      <div className="tau-form-title">{title}</div>
      {text && <div className="tau-form-text">{text}</div>}
      <SchemaField schema={schema} root={schema} value={value} onChange={setValue} id={idPrefix} />
      {extra}
      {error && (
        <div className="tau-error" role="alert">
          {error}
        </div>
      )}
      <div className="tau-form-buttons">
        <button type="submit" disabled={working}>
          {submitLabel}
        </button>
        {secondary && (
          <button type="button" disabled={working} onClick={() => void act(secondary.onClick)}>
            {secondary.label}
          </button>
        )}
      </div>
    </form>
  );
}
