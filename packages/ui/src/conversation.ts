import type { TauClient, WireEvent } from '@tau-code/protocol';

/**
 * The conversation store.
 *
 * Framework-agnostic on purpose: React binds to it in `useTau.ts`, and a future
 * head in another framework can bind to the same object.
 *
 * ## Why this is a hybrid, and not a pure event reducer
 *
 * tau's event stream carries NO message content and NO tool arguments. That is
 * deliberate (REMOTE-CONTROL.md G3, "nothing unbounded is pushed"): the ten
 * event types carry identity, timing and a bounded per-chunk `delta`, and
 * `agent_end` carries a `message_count` rather than the messages.
 *
 * So there are two sources and they answer different questions:
 *
 *   - **The event stream is the LIVE view.** `delta` accumulates into the text
 *     the reader watches appear. Tool calls show up by name with a status.
 *   - **`get_messages` is the DURABLE view.** After `agent_end`, this store
 *     pulls it and replaces the live buffer with the authoritative array.
 *
 * A consequence worth stating plainly, because it looks like a bug otherwise:
 * **tool arguments and tool results are not available while a tool runs.** They
 * are not on the wire. During a call the UI can honestly show the tool's name
 * and that it is running; the arguments arrive with the pull at turn end.
 * Showing a spinner and a name is the truthful rendering of what is known.
 */

export type BlockKind = 'text' | 'thinking';

export interface LiveBlock {
  kind: BlockKind;
  text: string;
}

export type ToolStatus = 'running' | 'done' | 'error' | 'blocked';

export interface LiveToolCall {
  toolCallId: string;
  name: string;
  status: ToolStatus;
  /** The extension that vetoed the call, when status is 'blocked'. */
  blockedBy: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface ConversationState {
  /** The authoritative message array from the last `get_messages` pull. */
  messages: unknown[];
  /** Text and thinking accumulated from deltas during the running turn. */
  live: LiveBlock[];
  /** Tool calls seen this turn, in the order they started. */
  liveTools: LiveToolCall[];
  /** True between `agent_start` and `agent_end`. */
  running: boolean;
  /** The turn index tau last reported. */
  turnIndex: number | null;
  /**
   * How the last run ended. `max_turns` and `repeat_tool_calls` mean the answer
   * is TRUNCATED, not finished -- worth showing, because the transcript alone
   * cannot distinguish them from a model that simply stopped.
   */
  endReason: WireEvent['end_reason'];
  /** Set when the loop raised rather than finishing. */
  error: string | null;
  /**
   * The session cursor as of the last event or mutation that reported one.
   *
   * F3: no host may cache "the tip". This is a DISPLAY of the last value tau
   * reported, never an input to a later request. Nothing in this store sends it
   * back.
   */
  cursor: string | null;
  /** A short, human-readable note about the last protocol-level surprise. */
  notice: string | null;
}

const EMPTY: ConversationState = {
  messages: [],
  live: [],
  liveTools: [],
  running: false,
  turnIndex: null,
  endReason: null,
  error: null,
  cursor: null,
  notice: null,
};

export class Conversation {
  #state: ConversationState = EMPTY;
  #listeners = new Set<(state: ConversationState) => void>();
  #unsubscribe: Array<() => void> = [];
  #client: TauClient;

  constructor(client: TauClient) {
    this.#client = client;
    this.#unsubscribe.push(
      client.on('event', (event) => this.#apply(event)),
      client.on('close', (reason) => this.#patch({ running: false, notice: reason })),
      client.on('protocolViolation', (detail) => this.#patch({ notice: detail })),
      client.on('compactionEnd', (params) => {
        const what = params.cancelled ? 'cancelled' : params.performed ? 'performed' : 'nothing to do';
        this.#patch({ notice: `Compaction ${what}.` });
        void this.refresh();
      }),
    );
  }

  get state(): ConversationState {
    return this.#state;
  }

  subscribe(listener: (state: ConversationState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    this.#listeners.clear();
  }

  /** Pull the authoritative message array and clear the live buffer. */
  async refresh(): Promise<void> {
    const result = await this.#client.call('get_messages', {});
    this.#patch({ messages: result.messages ?? [], live: [], liveTools: [] });
  }

  /**
   * Move this connection onto another session.
   *
   * The three session verbs share a shape worth handling in one place: each can
   * answer `{cancelled: true}` because an extension hook vetoed it, and each can
   * fail with TURN_STILL_RUNNING when a turn would not stop. A veto is a
   * decision, not an error -- nothing was touched -- so it is reported rather
   * than thrown, and the caller does not have to tell the two apart.
   */
  async switchTo(sessionId: string): Promise<boolean> {
    const result = await this.#client.call('switch_session', { session_id: sessionId });
    return this.#afterSessionChange(result, `Switched to ${sessionId.slice(0, 8)}.`);
  }

  /** Start a fresh conversation on the same warm agent. */
  async newSession(): Promise<boolean> {
    const result = await this.#client.call('new_session', {});
    return this.#afterSessionChange(result, 'Started a new session.');
  }

  /** Branch this session's history into a new one and move onto it. */
  async fork(): Promise<boolean> {
    const result = await this.#client.call('fork', {});
    return this.#afterSessionChange(result, 'Forked this session.');
  }

  async #afterSessionChange(result: { cancelled?: boolean }, done: string): Promise<boolean> {
    if (result.cancelled === true) {
      this.#patch({ notice: 'An extension refused that. Nothing was changed.' });
      return false;
    }
    // The transcript is a different conversation now, and none of it was
    // pushed. Everything on screen is stale until this returns.
    this.#patch({ live: [], liveTools: [], endReason: null, error: null, notice: done });
    await this.refresh();
    return true;
  }

  #patch(partial: Partial<ConversationState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const listener of this.#listeners) listener(this.#state);
  }

  #apply(event: WireEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.#patch({
          running: true,
          live: [],
          liveTools: [],
          endReason: null,
          error: null,
          notice: null,
        });
        return;

      case 'turn_start':
        this.#patch({ turnIndex: event.turn_index ?? null });
        return;

      case 'message_update': {
        const delta = event.delta;
        const kind = event.block_type;
        if (typeof delta !== 'string' || (kind !== 'text' && kind !== 'thinking')) return;
        this.#patch({ live: appendDelta(this.#state.live, kind, delta, event.replace === true) });
        return;
      }

      case 'tool_execution_start': {
        const id = event.tool_call_id;
        if (typeof id !== 'string') return;
        const call: LiveToolCall = {
          toolCallId: id,
          name: event.tool_name ?? '(unnamed tool)',
          status: 'running',
          blockedBy: null,
          startedAt: event.timestamp,
          endedAt: null,
        };
        this.#patch({ liveTools: [...this.#state.liveTools, call] });
        return;
      }

      case 'tool_execution_end': {
        const id = event.tool_call_id;
        if (typeof id !== 'string') return;
        // `blocked` is an extension veto, which is a different outcome from a
        // tool that ran and failed. Collapsing them would hide a policy
        // decision behind what looks like a bug in the tool.
        const status: ToolStatus = event.blocked === true ? 'blocked' : event.is_error === true ? 'error' : 'done';
        this.#patch({
          liveTools: this.#state.liveTools.map((call) =>
            call.toolCallId === id
              ? { ...call, status, blockedBy: event.blocked_by ?? null, endedAt: event.timestamp }
              : call,
          ),
        });
        return;
      }

      case 'agent_end': {
        this.#patch({
          running: false,
          endReason: event.end_reason ?? null,
          error: event.error ?? null,
          cursor: event.cursor ?? this.#state.cursor,
        });
        // The messages themselves were never pushed. Pull them now.
        void this.refresh().catch((error: unknown) => {
          this.#patch({
            notice: `Could not read the finished messages: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        });
        return;
      }

      default:
        // turn_end, message_start, message_end, tool_execution_update carry no
        // state this view needs. Ignored on purpose, not overlooked.
        return;
    }
  }
}

/**
 * Fold one delta into the live blocks.
 *
 * `replace: true` means the provider replaced rather than extended the block:
 * the delta is the block's ENTIRE new value and the accumulator must be reset,
 * not appended to. Getting this backwards produces text that doubles itself,
 * which is the kind of bug that looks like a model problem.
 */
function appendDelta(blocks: LiveBlock[], kind: BlockKind, delta: string, replace: boolean): LiveBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === kind) {
    const text = replace ? delta : last.text + delta;
    return [...blocks.slice(0, -1), { kind, text }];
  }
  return [...blocks, { kind, text: delta }];
}
