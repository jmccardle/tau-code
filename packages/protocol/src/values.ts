/**
 * Reading serde-tagged core values (protocol.md "Reading a value"): a unit variant is a bare
 * string (`"Core"`, `"Done"`), a variant with data a one-key object (`{"User": "hi"}`). These turn
 * them into what a view shows. Pure functions; no τ concept is added here.
 */
import type { Author, Body, Ending, Image, ItemData, Outcome, Prose } from './generated.js';

/** Who wrote something: `you`-agnostic, e.g. `provider`, `frontend john@laptop:web`. */
export function authorText(author: Author): string {
  if (typeof author === 'string') return author.toLowerCase();
  if ('Frontend' in author) return author.Frontend;
  return `extension ${author.Extension}`;
}

/** Whether `author` is the frontend `client`. */
export function isFrontend(author: Author, client: string): boolean {
  return typeof author === 'object' && 'Frontend' in author && author.Frontend === client;
}

/** A body's variant name: `System`, `User`, `Assistant`, `Results`, `Config` or `Custom`. */
export function bodyKind(body: Body): 'System' | 'User' | 'Assistant' | 'Results' | 'Config' | 'Custom' {
  return Object.keys(body)[0] as ReturnType<typeof bodyKind>;
}

/** A part's text, signed or not. */
export function proseText(prose: Prose): string {
  return typeof prose === 'string' ? prose : prose.text;
}

/** How a step ended, as a phrase: `done`, `aborted`, `halted: why`, `failed: why`. */
export function endingText(ending: Ending): string {
  if (ending === 'Done') return 'done';
  if (ending === 'Aborted') return 'aborted';
  if ('Halted' in ending) return `halted: ${ending.Halted}`;
  return `failed: ${ending.Failed}`;
}

/**
 * A call's outcome: whether it failed, its text, and the images an `Ok` carries (protocol 2, D30).
 * `Ok` is the bare text when there are no images, `{value, images}` when there are.
 */
export function outcomeOf(outcome: Outcome): { ok: boolean; text: string; images: Image[] } {
  if (outcome === 'Interrupted') return { ok: false, text: 'interrupted', images: [] };
  if ('Ok' in outcome) {
    const ok = outcome.Ok;
    if (typeof ok === 'string') return { ok: true, text: ok, images: [] };
    return { ok: true, text: ok.value, images: ok.images };
  }
  return { ok: false, text: outcome.Err, images: [] };
}

/**
 * An image as a label, the way τ's terminal UI and `tau export` show one: `[image WxH mime]`.
 * The wire carries no bytes (protocol 2 has no call that fetches them), so a label is all a
 * client can draw.
 */
export function imageLabel(image: Image): string {
  return `[image ${image.width}x${image.height} ${image.mime}]`;
}

/** A pending item, as a line: its text and who wrote it. */
export function itemText(data: ItemData): { by: string; text: string; author: Author | null } {
  if ('Input' in data) return { by: authorText(data.Input.by), text: data.Input.text, author: data.Input.by };
  return { by: `extension ${data.Extension.name}`, text: data.Extension.data, author: null };
}
