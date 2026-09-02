/**
 * Reading `get_models`, and deciding what may honestly be called "active".
 *
 * Same check-then-narrow discipline as `sessions.ts`: the wire declares
 * `models` as a bare array, so the row shape is a client-side claim and it is
 * checked rather than cast.
 *
 * ## A name is not an id
 *
 * `set_model` takes a config NAME -- a key in tau's `models` map. `get_state`
 * reports the running model as an `id` and a `provider`, which is what the name
 * RESOLVED to. In this repo owner's own config, `local-llm` resolves to
 * `qwen38-27B`. The two strings are not interchangeable and neither one can be
 * derived from the other.
 *
 * ## Why `activeNames` returns a list and not a row
 *
 * `get_models` does not flag which entry is active, and tau's protocol
 * documentation says plainly why: two config names may resolve to the same
 * model, and a startup `--model provider/id` is an ad-hoc model with no config
 * key at all. So there are three cases and they are different facts:
 *
 *  - **one name matches** -- that row can be marked active.
 *  - **several match** -- the config aliases one model, and WHICH name is
 *    active is not on the wire. Marking one of them would be a guess.
 *  - **none match** -- the running model has no config name, so `set_model`
 *    cannot switch back to it. Leaving is one-way, and the reader is told
 *    before they click rather than after.
 *
 * ## What is dropped, and why
 *
 * `context_window`. tau assigns every config entry the same 128000 today,
 * including the active one, so the numbers carry no difference. Showing them
 * would invite a reader to compare models on a figure the child does not
 * actually make.
 */

export interface ModelRow {
  /** The exact string `set_model` takes: a key in tau's config `models` map. */
  name: string;
  /** What that name resolves to. Not the name; a config key may alias one. */
  id: string | null;
  provider: string | null;
}

/** The running model, as `get_state` and `set_model` both project it. */
export interface ActiveModel {
  id: string | null;
  provider: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

export function readModelRows(models: unknown[]): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const entry of models) {
    const record = asRecord(entry);
    if (!record) continue;
    const name = str(record, 'name');
    // A row with no name is not switchable, so it is not a row. This is the
    // only thing dropped, and only because the picker's whole purpose is to
    // produce a name for `set_model`.
    if (!name) continue;
    const model = asRecord(record['model']);
    rows.push({
      name,
      id: model ? str(model, 'id') : null,
      provider: model ? str(model, 'provider') : null,
    });
  }
  return rows;
}

/** The `{id, provider}` projection, from `get_state` or from `set_model`. */
export function readActiveModel(value: unknown): ActiveModel | null {
  const record = asRecord(value);
  if (!record) return null;
  return { id: str(record, 'id'), provider: str(record, 'provider') };
}

/**
 * Every config name that resolves to the running model.
 *
 * Both fields have to match. A provider is part of what a model IS -- the same
 * id served by two providers is two models, and tau's own notes say a
 * cross-provider switch is where an auth error shows up.
 */
export function activeNames(rows: ModelRow[], active: ActiveModel | null): string[] {
  if (!active || !active.id) return [];
  return rows
    .filter((row) => row.id === active.id && row.provider === active.provider)
    .map((row) => row.name);
}

/** `provider/id`, or the id alone when tau reported no provider. */
export function modelLabel(model: ActiveModel | null): string | null {
  if (!model || !model.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}
