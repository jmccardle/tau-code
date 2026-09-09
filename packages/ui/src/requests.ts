import type { TauClient } from '@ffwf/tau-code-protocol';

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
 * parent node in the tree browser. The third is why this panel and that one
 * belong in the same head: navigating past the request clears it, because a lock
 * is read AT THE CURSOR and never by walking ancestry.
 */

/** One field of an ask, as `validate_ask_spec` normalized it. */
export interface AskField {
  name: string;
  kind: 'text' | 'number' | 'confirm' | 'select' | 'multiselect';
  label: string;
  default?: unknown;
  options?: string[];
}

export interface AskAction {
  label: string;
  command: string;
}

export interface Ask {
  title: string;
  body: Record<string, unknown> | null;
  fields: AskField[];
  actions: AskAction[];
}

export interface ExtensionRequest {
  entryId: string;
  extension: string;
  extensionName: string;
  /** The extension's own one line. */
  sentence: string;
  /** tau's framing of the four states. Sent rather than derived here. */
  label: string;
  lock: boolean;
  ask: Ask | null;
  /** A command that clears the lock, or null. Advisory. */
  release: string | null;
}

const FIELD_KINDS = new Set(['text', 'number', 'confirm', 'select', 'multiselect']);

function readField(raw: unknown, index: number): AskField {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError(`get_pending_request().request.ask.fields[${index}] is not an object.`);
  }
  const record = raw as Record<string, unknown>;
  const kind = String(record['kind'] ?? 'text');
  if (!FIELD_KINDS.has(kind)) {
    throw new TypeError(
      `get_pending_request().request.ask.fields[${index}].kind is '${kind}', which this head cannot render.`,
    );
  }
  const options = record['options'];
  return {
    name: String(record['name']),
    kind: kind as AskField['kind'],
    label: typeof record['label'] === 'string' ? record['label'] : String(record['name']),
    ...(record['default'] === undefined ? {} : { default: record['default'] }),
    ...(Array.isArray(options) ? { options: options.map(String) } : {}),
  };
}

function readAsk(raw: unknown): Ask | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') throw new TypeError('get_pending_request().request.ask is not an object.');
  const record = raw as Record<string, unknown>;
  const fields = record['fields'];
  const actions = record['actions'];
  if (!Array.isArray(actions) || actions.length === 0) {
    // An ask with no action is a notification, and tau refuses to build one, so
    // seeing it here means the entry was written by something other than the API.
    throw new TypeError('get_pending_request().request.ask declares no actions.');
  }
  return {
    title: typeof record['title'] === 'string' ? record['title'] : 'Request',
    body: typeof record['body'] === 'object' && record['body'] !== null ? (record['body'] as Record<string, unknown>) : null,
    fields: Array.isArray(fields) ? fields.map(readField) : [],
    actions: actions.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new TypeError(`get_pending_request().request.ask.actions[${index}] is not an object.`);
      }
      const action = entry as Record<string, unknown>;
      return { label: String(action['label']), command: String(action['command']) };
    }),
  };
}

/** Read the request at the cursor, or null. Null is the ordinary answer. */
export async function loadPendingRequest(client: TauClient): Promise<ExtensionRequest | null> {
  const result = await client.call('get_pending_request', {});
  const raw = result.request;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') throw new TypeError('get_pending_request().request is not an object.');
  const record = raw as Record<string, unknown>;
  return {
    entryId: String(record['entry_id']),
    extension: String(record['extension']),
    extensionName: String(record['extension_name']),
    sentence: String(record['sentence']),
    label: String(record['label']),
    lock: record['lock'] === true,
    ask: readAsk(record['ask']),
    release: typeof record['release'] === 'string' ? record['release'] : null,
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
  client: TauClient,
  request: ExtensionRequest,
  action: string,
  values: Record<string, unknown>,
): Promise<{ handled: boolean; output: string | null }> {
  const result = await client.call('answer_request', {
    request_id: request.entryId,
    action,
    values,
  });
  return {
    handled: result.handled === true,
    output: typeof result.output === 'string' ? result.output : null,
  };
}

/**
 * A field's starting value, by kind.
 *
 * The declared default, else the empty value the kind takes -- which is what
 * tau's own form widget falls back to. An empty answer is the field's VALUE, not
 * a cancellation: a form with one optional-in-practice box has to be
 * submittable.
 */
export function initialValues(ask: Ask): Record<string, unknown> {
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
