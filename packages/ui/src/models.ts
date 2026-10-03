import type { ModelRecord } from '@ffwf/tau-code-protocol';

/**
 * The model picker's rows.
 *
 * ## A name is not an id
 *
 * A row is a NAME -- a key in the daemon's config `models` map, the one string
 * `set_model` takes -- and the `{id, provider}` it resolves to. Two names may
 * resolve to the same model (an alias), so the running model is named, not
 * matched: a cursor's `model` is the name it was set to, and the picker marks
 * exactly that row.
 */

export type { ModelRecord };

/** `provider/id`, the model a name resolves to. */
export function modelLabel(record: ModelRecord): string {
  return `${record.model.provider}/${record.model.id}`;
}

/** The record for `name`, or null when the daemon's config no longer has it. */
export function recordFor(models: readonly ModelRecord[], name: string | null): ModelRecord | null {
  if (name === null) return null;
  return models.find((record) => record.name === name) ?? null;
}

/**
 * Every name that resolves to the same model as `name`, `name` included.
 *
 * Shown as a hint, not a selection: switching to an alias of the running model
 * changes nothing the model does, and the reader should be able to see that
 * before clicking.
 */
export function aliasesOf(models: readonly ModelRecord[], name: string | null): string[] {
  const active = recordFor(models, name);
  if (!active) return [];
  return models
    .filter((record) => record.model.id === active.model.id && record.model.provider === active.model.provider)
    .map((record) => record.name);
}
