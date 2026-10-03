import {
  Replica,
  type Attached,
  type CompactionEnd,
  type CursorState,
  type Event,
  type ReplicaEntry,
  type FormSpec,
  type ServeClient,
  type SubmissionStartPayload,
  type UiEventData,
  type WireEvent,
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
 * cursor queues the prompt (`enqueue`) instead.
 */

export type BlockKind = 'text' | 'thinking';

export interface LiveBlock {
  kind: BlockKind;
  text: string;
}

export interface LiveToolCall {
  toolCallId: string;
  name: string;
  /** The arguments, from the assistant entry that requested the call; null if this view does not hold it. */
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
  spec: FormSpec;
}

/** An extension's display call: a notification, a status line, a panel. */
export interface UiCall {
  seq: number;
  data: UiEventData;
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
  /**
   * How the last compaction ended, in a sentence. A compaction finishes after
   * the request that started it has answered, so its outcome arrives as its
   * own event -- and a failed one changed nothing, which the reader must hear.
   */
  compaction: { text: string; failed: boolean } | null;
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
      compaction: null,
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
    const forms = attached.requests.map((form) => ({ requestId: form.request_id, spec: form.spec }));
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
    switch (event.kind) {
      case 'agent_event':
        if (event.data.cursor_id === this.#state.cursorId) this.#live(event.data);
        return;
      case 'channel':
        if (event.data.name === 'submission_start') this.#submissionStart(event.data.payload);
        return;
      case 'request': {
        const { request_id, spec } = event.data;
        this.#patch({
          forms: [...this.#state.forms.filter((form) => form.requestId !== request_id), { requestId: request_id, spec }],
        });
        return;
      }
      case 'request_closed':
        this.#patch({ forms: this.#state.forms.filter((form) => form.requestId !== event.data.request_id) });
        return;
      case 'ui':
        this.#patch({ ui: [...this.#state.ui, { seq: event.seq, data: event.data }].slice(-UI_KEPT) });
        return;
      case 'compaction_end':
        this.#patch({ compaction: compactionSentence(event.data) });
        return;
      default:
        return;
    }
  }

  #submissionStart(payload: SubmissionStartPayload): void {
    if (payload.attachments === null) return;
    const { expanded, images, unresolved, failures } = payload.attachments;
    this.#patch({
      attachments: {
        submissionId: payload.submission.submission_id,
        report: { expanded, images, unresolved, failures },
      },
    });
  }

  /**
   * A tool call's arguments, from the assistant entry that asked for it.
   *
   * The event stream deliberately carries no arguments: the assistant message
   * that requested the call is finalized as an entry before the tool runs, and
   * it is on the same socket, so the arguments are read from there -- the join
   * τ's own TUI makes (`serve/remote.py` `WireJoin`). Searched newest first,
   * because it is the last assistant entry this cursor wrote.
   */
  #argumentsOf(toolCallId: string): Record<string, unknown> | null {
    const path = this.#state.path;
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const entry = path[i];
      if (entry?.type !== 'message') continue;
      const message = (entry as Extract<ReplicaEntry, { type: 'message' }>).message;
      if (message.role !== 'assistant') continue;
      for (const block of message.content) {
        if (block.type === 'toolCall' && block.id === toolCallId) return block.arguments;
      }
    }
    return null;
  }

  #live(event: WireEvent): void {
    const live = this.#state.live;
    switch (event.type) {
      case 'agent_start':
        this.#patch({ live: { ...NO_LIVE, cacheNotice: live.cacheNotice } });
        return;
      case 'message_start':
        this.#patch({ live: { ...live, blocks: [] } });
        return;
      case 'message_update': {
        const { delta, block_type: kind } = event;
        if (typeof delta !== 'string' || (kind !== 'text' && kind !== 'thinking')) return;
        this.#patch({ live: { ...live, blocks: appendDelta(live.blocks, kind, delta, event.replace === true) } });
        return;
      }
      case 'message_end': {
        // The finished message is an entry now; the live copy would draw it twice.
        const truncation =
          event.stop_reason === 'length' ? { droppedToolCalls: event.dropped_tool_calls ?? null } : live.truncation;
        this.#patch({ live: { ...live, blocks: [], truncation } });
        return;
      }
      case 'tool_execution_start': {
        const id = event.tool_call_id;
        if (!id) return;
        const call: LiveToolCall = {
          toolCallId: id,
          name: event.tool_name ?? '(unnamed tool)',
          args: this.#argumentsOf(id),
          startedAt: event.timestamp,
        };
        this.#patch({ live: { ...live, tools: [...live.tools, call] } });
        return;
      }
      case 'tool_execution_end':
        // The result is a toolResult entry; the running row has done its job.
        this.#patch({ live: { ...live, tools: live.tools.filter((call) => call.toolCallId !== event.tool_call_id) } });
        return;
      case 'agent_end': {
        const notice = event.cache_notice ?? null;
        const fresh = notice !== null && !this.#cacheWarned.has(notice);
        if (fresh) this.#cacheWarned.add(notice);
        this.#patch({
          live: {
            ...live,
            blocks: [],
            tools: [],
            endReason: event.end_reason ?? null,
            error: event.error ?? null,
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

  /**
   * Re-read the session's surface -- commands, extensions, load errors -- after
   * something changed it (an extension enabled, disabled or reloaded). The
   * surface rides in `attach`'s answer and is not pushed, so this is the read.
   */
  async describe(): Promise<void> {
    const { client } = this.at();
    const surface = await client.request('describe', { session_id: this.sessionId });
    const attached = this.#state.attached;
    if (attached) this.#patch({ attached: { ...attached, surface } });
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

function compactionSentence(end: CompactionEnd): { text: string; failed: boolean } {
  if (end.is_error) return { text: `Compaction failed: ${end.error ?? 'τ gave no reason'}. Nothing was changed.`, failed: true };
  if (end.cancelled) return { text: 'Compaction was cancelled. Nothing was changed.', failed: false };
  if (!end.performed) return { text: 'Compaction found nothing to compact.', failed: false };
  const saved = end.tokens_saved === undefined ? '' : ` It saved about ${end.tokens_saved.toLocaleString()} tokens.`;
  return { text: `Compacted.${saved}`, failed: false };
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
