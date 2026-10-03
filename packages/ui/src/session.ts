import {
  Replica,
  type Attached,
  type CursorState,
  type Event,
  type ReplicaEntry,
  type ServeClient,
} from '@ffwf/tau-code-protocol';

/**
 * One attached session: the replica, which cursor this head drives, and what
 * that cursor's running turn looks like right now.
 *
 * ## Two sources, and which question each answers
 *
 * - **The replica is the durable view.** Every message is an entry, written
 *   when it exists and finalized when it is done; the transcript is the path
 *   from this head's cursor to the root. Nothing is pulled after a turn,
 *   because nothing was withheld.
 * - **`agent_event` is the live view.** Deltas accumulate into the text a
 *   reader watches appear, and a running tool shows its arguments. Events
 *   carry `cursor_id`, so a parallel turn on another cursor never paints into
 *   this one.
 *
 * Both describe the same turn, so they meet at one place: an entry whose
 * `status` is `"incomplete"`. While this cursor is busy that is the message
 * being written, and the live blocks stand in for it. Once the cursor is idle
 * it is an INTERRUPTED message -- the process died or the turn was aborted
 * mid-write -- and it is drawn as one.
 *
 * ## Which cursor
 *
 * The head cursor, by default: every head attached to a session, the TUI under
 * `--connect` included, then sees and extends one conversation. A parallel
 * turn is a cursor this head opens on purpose (`openCursor`), never something
 * that happens because a prompt arrived while another was running -- a busy
 * cursor queues the prompt as a follow-up instead.
 */

export type BlockKind = 'text' | 'thinking';

export interface LiveBlock {
  kind: BlockKind;
  text: string;
}

export interface LiveToolCall {
  toolCallId: string;
  name: string;
  /** The arguments, which `tool_execution_start` carries in full. */
  args: Record<string, unknown> | null;
  startedAt: number;
}

/** What `@file` expansion did to a submission, as `submission_start` reports it. */
export interface AttachmentReport {
  expanded: number;
  images: number;
  unresolved: string[];
  failures: string[];
}

export interface Live {
  /** The streaming message's blocks; empty between messages. */
  blocks: LiveBlock[];
  /** Tools running now, in the order they started. */
  tools: LiveToolCall[];
  /** How the last run on this cursor ended. Truncating reasons are shown. */
  endReason: string | null;
  /** Set when the last run raised rather than finishing. */
  error: string | null;
  /** The output cap ended a completion mid-word; the answer is a prefix. */
  truncation: { droppedToolCalls: number | null } | null;
  /** τ's sentence that a prompt cache should have been read and was not. */
  cacheNotice: string | null;
}

/** An extension's form, opened by a `request` event and closed by `request_closed`. */
export interface OpenForm {
  requestId: string;
  spec: Record<string, unknown>;
}

/** An extension's display call: a notification, a status line, a panel. */
export interface UiCall {
  seq: number;
  op: string;
  data: Record<string, unknown>;
}

export interface SessionState {
  sessionId: string;
  /** True once the first `attach` answered. */
  loaded: boolean;
  /** Why this session could not be shown, or null. */
  failure: string | null;
  /** The last `attach` answer: cwd, models, surface. */
  attached: Attached | null;
  cursorId: string | null;
  cursor: CursorState | null;
  cursors: readonly CursorState[];
  /** Root→leaf entries at this head's cursor. */
  path: readonly ReplicaEntry[];
  /** A parent the path names and the replica does not hold, or null. */
  missingParent: string | null;
  /** Bumped on every replica change, for views that read the replica directly. */
  revision: number;
  live: Live;
  forms: readonly OpenForm[];
  /** The latest few extension display calls, newest last. */
  ui: readonly UiCall[];
  /** The last submission's attachment report, keyed by its submission id. */
  attachments: { submissionId: string; report: AttachmentReport } | null;
}

const NO_LIVE: Live = {
  blocks: [],
  tools: [],
  endReason: null,
  error: null,
  truncation: null,
  cacheNotice: null,
};

/** How many `ui` calls are kept; older ones have been seen or superseded. */
const UI_KEPT = 20;

export class SessionStore {
  readonly sessionId: string;
  #replica: Replica;
  #client: ServeClient | null = null;
  #offEvent: (() => void) | null = null;
  #listeners = new Set<(state: SessionState) => void>();
  #state: SessionState;
  /** Cache notices already shown; the condition persists, the sentence repeats every turn. */
  #cacheWarned = new Set<string>();
  /** Set while a gap re-attach is in flight, so a burst of gaps asks once. */
  #resyncing = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.#replica = new Replica(sessionId);
    this.#state = {
      sessionId,
      loaded: false,
      failure: null,
      attached: null,
      cursorId: null,
      cursor: null,
      cursors: [],
      path: [],
      missingParent: null,
      revision: 0,
      live: NO_LIVE,
      forms: [],
      ui: [],
      attachments: null,
    };
  }

  get state(): SessionState {
    return this.#state;
  }

  get replica(): Replica {
    return this.#replica;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #patch(partial: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const listener of this.#listeners) listener(this.#state);
  }

  dispose(): void {
    this.#offEvent?.();
    this.#offEvent = null;
    this.#listeners.clear();
  }

  fail(reason: string): void {
    this.#patch({ failure: reason });
  }

  /** The first attach: a snapshot, and this head takes the head cursor. */
  async attach(client: ServeClient): Promise<void> {
    this.#bind(client);
    const attached = await client.request('attach', { session_id: this.sessionId });
    this.#take(attached, attached.head_cursor_id);
  }

  /** Attach again on a new connection, resuming from what the replica holds. */
  async reattach(client: ServeClient): Promise<void> {
    this.#bind(client);
    const resume = this.#replica.resume;
    const attached = await client.request('attach', {
      session_id: this.sessionId,
      ...(resume ? { epoch: resume.epoch, since: resume.since } : {}),
    });
    // Keep this head's cursor if it survived; a daemon restart may have closed
    // every cursor but the head, and then the head is the honest place to be.
    const kept = this.#state.cursorId;
    const survives = kept !== null && attached.cursors.some((cursor) => cursor.cursor_id === kept);
    this.#take(attached, survives ? kept : attached.head_cursor_id);
  }

  #bind(client: ServeClient): void {
    this.#offEvent?.();
    this.#client = client;
    this.#offEvent = client.on('event', (event) => {
      if (event.session_id === this.sessionId) this.#apply(event);
    });
  }

  #take(attached: Attached, cursorId: string): void {
    this.#replica.applyAttached(attached);
    const forms = (attached.requests ?? []).map((form) => ({
      requestId: String(form.request_id),
      spec: form.spec as Record<string, unknown>,
    }));
    this.#patch({ loaded: true, failure: null, attached, cursorId, forms, ...this.#derived(cursorId) });
  }

  #derived(cursorId: string | null): Pick<SessionState, 'cursor' | 'cursors' | 'path' | 'missingParent' | 'revision'> {
    const cursor = cursorId === null ? null : this.#replica.cursor(cursorId);
    const { entries, missingParent } = this.#replica.path(cursor?.leaf ?? null);
    return {
      cursor,
      cursors: this.#replica.cursors,
      path: entries,
      missingParent,
      revision: this.#state.revision + 1,
    };
  }

  #apply(event: Event): void {
    const outcome = this.#replica.apply(event);
    if (outcome === 'duplicate') return;
    if (outcome === 'gap') {
      void this.#resync();
      return;
    }
    if (outcome === 'applied') {
      this.#patch(this.#derived(this.#state.cursorId));
      return;
    }
    this.#passed(event);
  }

  async #resync(): Promise<void> {
    if (this.#resyncing || !this.#client) return;
    this.#resyncing = true;
    try {
      await this.reattach(this.#client);
    } catch (error) {
      this.fail(`Lost track of this session and could not resume it: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.#resyncing = false;
    }
  }

  /** A stateless event: live view, forms, display calls, attachment reports. */
  #passed(event: Event): void {
    const data = (event.data ?? {}) as Record<string, unknown>;
    switch (event.kind) {
      case 'agent_event':
        if (data['cursor_id'] === this.#state.cursorId) this.#live(data);
        return;
      case 'channel':
        this.#channel(data);
        return;
      case 'request':
        this.#patch({
          forms: [
            ...this.#state.forms.filter((form) => form.requestId !== String(data['request_id'])),
            { requestId: String(data['request_id']), spec: data['spec'] as Record<string, unknown> },
          ],
        });
        return;
      case 'request_closed':
        this.#patch({ forms: this.#state.forms.filter((form) => form.requestId !== String(data['request_id'])) });
        return;
      case 'ui':
        this.#patch({ ui: [...this.#state.ui, { seq: event.seq, op: String(data['op']), data }].slice(-UI_KEPT) });
        return;
      default:
        return;
    }
  }

  #channel(data: Record<string, unknown>): void {
    if (data['name'] !== 'submission_start') return;
    const payload = (data['payload'] ?? {}) as Record<string, unknown>;
    const submission = (payload['submission'] ?? {}) as Record<string, unknown>;
    const report = payload['attachments'];
    if (report === null || report === undefined || typeof submission['submission_id'] !== 'string') return;
    const record = report as Record<string, unknown>;
    const strings = (key: string): string[] => (Array.isArray(record[key]) ? (record[key] as unknown[]).map(String) : []);
    this.#patch({
      attachments: {
        submissionId: submission['submission_id'],
        report: {
          expanded: Number(record['expanded'] ?? 0),
          images: Number(record['images'] ?? 0),
          unresolved: strings('unresolved'),
          failures: strings('failures'),
        },
      },
    });
  }

  #live(event: Record<string, unknown>): void {
    const live = this.#state.live;
    switch (event['type']) {
      case 'agent_start':
        this.#patch({ live: { ...NO_LIVE, cacheNotice: live.cacheNotice } });
        return;
      case 'message_start':
        this.#patch({ live: { ...live, blocks: [] } });
        return;
      case 'message_update': {
        const delta = event['delta'];
        const kind = event['block_type'];
        if (typeof delta !== 'string' || (kind !== 'text' && kind !== 'thinking')) return;
        this.#patch({ live: { ...live, blocks: appendDelta(live.blocks, kind, delta, event['replace'] === true) } });
        return;
      }
      case 'message_end': {
        // The finished message is an entry now; the live copy would draw it twice.
        const truncation =
          event['stop_reason'] === 'length'
            ? { droppedToolCalls: typeof event['dropped_tool_calls'] === 'number' ? event['dropped_tool_calls'] : null }
            : live.truncation;
        this.#patch({ live: { ...live, blocks: [], truncation } });
        return;
      }
      case 'tool_execution_start': {
        const id = event['tool_call_id'];
        if (typeof id !== 'string') return;
        const args = event['args'];
        const call: LiveToolCall = {
          toolCallId: id,
          name: typeof event['tool_name'] === 'string' ? event['tool_name'] : '(unnamed tool)',
          args: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : null,
          startedAt: Number(event['timestamp'] ?? Date.now()),
        };
        this.#patch({ live: { ...live, tools: [...live.tools, call] } });
        return;
      }
      case 'tool_execution_end': {
        // The result is a toolResult entry; the running row has done its job.
        const id = event['tool_call_id'];
        this.#patch({ live: { ...live, tools: live.tools.filter((call) => call.toolCallId !== id) } });
        return;
      }
      case 'agent_end': {
        const notice = typeof event['cache_notice'] === 'string' ? event['cache_notice'] : null;
        const fresh = notice !== null && !this.#cacheWarned.has(notice);
        if (fresh) this.#cacheWarned.add(notice);
        this.#patch({
          live: {
            ...live,
            blocks: [],
            tools: [],
            endReason: typeof event['end_reason'] === 'string' ? event['end_reason'] : null,
            error: typeof event['error'] === 'string' ? event['error'] : null,
            cacheNotice: fresh ? notice : live.cacheNotice,
          },
        });
        return;
      }
      default:
        return;
    }
  }

  // ── what this head does to its cursor ────────────────────────────────────

  #require(): { client: ServeClient; cursorId: string } {
    const client = this.#client;
    const cursorId = this.#state.cursorId;
    if (!client || client.closed) throw new Error('Not connected to tau serve.');
    if (!cursorId) throw new Error('This session has no cursor for this view yet.');
    return { client, cursorId };
  }

  /** Drive a different cursor of this session, e.g. one a compare opened. */
  useCursor(cursorId: string): void {
    if (!this.#replica.cursor(cursorId)) throw new Error(`This session has no cursor ${cursorId}.`);
    this.#patch({ cursorId, live: NO_LIVE, ...this.#derived(cursorId) });
  }

  /** Open a cursor at `leaf` for a parallel turn, and drive it. */
  async openCursor(leaf: string | null, label: string): Promise<string> {
    const { client } = this.#require();
    const opened = await client.request('open_cursor', { session_id: this.sessionId, leaf, label });
    const cursorId = (opened as { cursor_id: string }).cursor_id;
    // The `cursors` event that announces it may arrive after this answer; the
    // cursor is driven from now, and drawn once the event lands.
    this.#patch({ cursorId, live: NO_LIVE, ...this.#derived(cursorId) });
    return cursorId;
  }

  get client(): ServeClient | null {
    return this.#client;
  }

  get cursorId(): string | null {
    return this.#state.cursorId;
  }

  /** The `{session_id, cursor_id}` every cursor-scoped request carries. */
  at(): { client: ServeClient; session_id: string; cursor_id: string } {
    const { client, cursorId } = this.#require();
    return { client, session_id: this.sessionId, cursor_id: cursorId };
  }
}

/**
 * Fold one delta into the live blocks.
 *
 * `replace: true` means the provider replaced rather than extended the block:
 * the delta is the block's ENTIRE new value. Getting this backwards produces
 * text that doubles itself, which looks like a model fault.
 */
export function appendDelta(blocks: LiveBlock[], kind: BlockKind, delta: string, replace: boolean): LiveBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === kind) {
    return [...blocks.slice(0, -1), { kind, text: replace ? delta : last.text + delta }];
  }
  return [...blocks, { kind, text: delta }];
}
