import type { Ask, ExtensionRequest as WireRequest, FormField, PanelBody } from '@ffwf/tau-code-protocol';
import type { SessionStore } from './session.js';

/**
 * The extension request: a lock, an ask, or both.
 *
 * tau 0.10.0 removed `ui.confirm` / `ui.select` / `ui.input` -- three methods
 * that emitted nothing on the record stream, were answerable only through a
 * bound TUI delegate, and held the turn lock for as long as a human took. What
 * replaced them is one persisted tree entry carrying two independent facts:
 *
 * | `lock` | `ask`  | what it is                                            |
 * |--------|--------|-------------------------------------------------------|
 * | true   | set    | the session is stopped and there is a form to fill      |
 * | true   | null   | the session is stopped; the way out is a command        |
 * | false  | set    | a question, asked without stopping anything             |
 * | false  | null   | nothing is drawn -- this verb answers null              |
 *
 * **A lock is a tree node**, which is why this matters more here than a modal
 * would. It survives the process: start tau again on the same session and the
 * request is still under the cursor, still refusing every prompt. A head that
 * did not render it would show a composer that silently refuses everything typed
 * into it, with the reason sitting in a rejection payload nobody reads.
 *
 * ## Three ways out, all of them ordinary
 *
 * Answer the ask; run the `release` command the request names; or branch to the
 * parent node in the tree browser.
 *
 * ## Where it comes from
 *
 * Each cursor's state carries the request at its leaf (`CursorState.request`),
 * computed by the daemon with the same code `get_pending_request` used, and
 * re-sent whenever a cursor moves. So the panel appears and vanishes with the
 * cursor, and nothing here asks for it. The third is why this panel and that one
 * belong in the same head: navigating past the request clears it, because a lock
 * is read AT THE CURSOR and never by walking ancestry.
 */

export type { Ask, FormField as AskField, PanelBody };

/** The request at a cursor, in this head's casing. */
export interface ExtensionRequest {
  entryId: string;
  extension: string;
  extensionName: string;
  /** The extension's own one line. */
  sentence: string;
  /** τ's framing of the four states. Sent rather than derived here. */
  label: string;
  lock: boolean;
  ask: Ask | null;
  /** A command that clears the lock, or null. Advisory. */
  release: string | null;
}

export function requestOf(wire: WireRequest): ExtensionRequest {
  return {
    entryId: wire.entry_id,
    extension: wire.extension,
    extensionName: wire.extension_name,
    sentence: wire.sentence,
    label: wire.label,
    lock: wire.lock,
    ask: wire.ask,
    release: wire.release,
  };
}

/**
 * The sentence to show for a lock that declares no ask.
 *
 * There is nothing to answer, so this says who stopped the session, what they
 * said, and every way out -- including the two that are not commands. A head
 * that printed only the first would leave the reader stuck at a prompt that
 * refuses everything.
 */
export function refusalReason(request: ExtensionRequest): string {
  const escape =
    request.release === null
      ? 'It declared no command to clear it.'
      : `Run /${request.release} to clear it.`;
  return (
    `${request.extensionName} has stopped this session: ${request.sentence} ${escape} ` +
    `You can also branch past it in the conversation tree — a lock is read at the cursor, ` +
    `so moving off it clears it.`
  );
}

/**
 * Answer an ask.
 *
 * `handled: false` is a WARNING and not a failure: the extension that raised the
 * request is not loaded, so nothing ran -- but the response was appended and the
 * lock is gone either way, because a lock whose owner cannot answer must not
 * become a session nobody can continue.
 */
export async function answerRequest(
  session: SessionStore,
  request: ExtensionRequest,
  action: string,
  values: Record<string, unknown>,
): Promise<{ handled: boolean; output: string | null }> {
  const { client, session_id, cursor_id } = session.at();
  return client.request('answer_request', { session_id, cursor_id, request_id: request.entryId, action, values });
}

/**
 * A field's starting value, by kind.
 *
 * The declared default, else the empty value the kind takes -- which is what
 * tau's own form widget falls back to. An empty answer is the field's VALUE, not
 * a cancellation: a form with one optional-in-practice box has to be
 * submittable.
 */
export function initialValues(ask: { readonly fields: readonly FormField[] }): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of ask.fields) {
    if (field.default !== undefined) {
      values[field.name] = field.default;
      continue;
    }
    switch (field.kind) {
      case 'confirm':
        values[field.name] = false;
        break;
      case 'number':
        values[field.name] = 0;
        break;
      case 'multiselect':
        values[field.name] = [];
        break;
      case 'select':
        values[field.name] = field.options?.[0] ?? '';
        break;
      default:
        values[field.name] = '';
    }
  }
  return values;
}
