import { ServeClient } from './client.js';
import { ConnectionClosed, EdgeError, ProtocolViolation, ServeError } from './errors.js';
import { ERROR_CODES } from './generated.js';
import type { Method, Requests, Results, Welcome } from './generated.js';
import { SessionModel } from './session-model.js';
import type { Transport } from './transport.js';

/**
 * - `connecting`: the first connection is being made.
 * - `ready`: `hello` answered; the model is the session's.
 * - `reconnecting`: the connection went, and the link is making a new one (`detail` says why).
 * - `failed`: a refusal that trying again will not change (`detail` says which); `retry()` after
 *   the user has changed something.
 */
export type Phase = 'connecting' | 'ready' | 'reconnecting' | 'failed';

export interface LinkState {
  phase: Phase;
  /** Why the phase is not `ready`, as a sentence; null when it is. */
  detail: string | null;
  /** The final refusal's kind when `failed`, for a view to say what to do. */
  refusal: EdgeError['kind'] | 'protocol' | null;
  /** The current connection's model. A reconnect makes a new one. */
  model: SessionModel;
  /** `hello`'s answer on the current connection. */
  welcome: Welcome | null;
  /** The cursor this client follows: its `Live` is watched and its walk read. */
  focus: number | null;
  /** The last background call (watch, walk, tree) that failed, as a sentence. */
  problem: string | null;
  /** Whether the whole tree has been read (`loadTree`). */
  treeLoaded: boolean;
}

export interface LinkOptions {
  /** Open a new transport. Called for every (re)connect. An `EdgeError` says whether to retry. */
  open: () => Promise<Transport>;
  /** This client's stable id, for `hello`. */
  client: string;
  /** The event buffer to ask for, or the server's default. */
  buffer?: number;
  /** Backoff between attempts: `firstMs` doubling to `maxMs`. */
  retry?: { firstMs: number; maxMs: number };
}

/** How many nodes one `nodes` call asks for when reading the whole tree. */
export const TREE_PAGE = 500;

/**
 * One client's link to a `tau serve`: the connection, and the session model over it.
 *
 * Framework-agnostic: a view subscribes to `state` and calls `call`. A host hands it a way to open
 * a transport, not a transport, since a link outlives several connections.
 *
 * **What reconnects.** A dropped stream, a server restart and a `CutOff` (fell behind) all
 * reconnect: a new transport, a new `hello`, a fresh snapshot into a new model (there is no resume;
 * the log is the truth). The phase says `reconnecting` the whole time, with why.
 *
 * **What does not.** A refused token (401), a refused origin (403), something that is not τ's
 * edge, and a protocol mismatch are final: retrying repeats the same answer. They end in `failed`
 * with the sentence, and `retry()` tries again once the user has changed something.
 *
 * **Focus.** The link follows one cursor: it `watch`es it (re-sent on every connection) and reads
 * its walk whenever the model does not hold the chain to its `at`.
 */
export class SessionLink {
  readonly #options: LinkOptions;
  #state: LinkState;
  readonly #listeners = new Set<(state: LinkState) => void>();
  #client: ServeClient | null = null;
  #retryMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;
  #generation = 0;
  #walking: number | null = null;
  #unsubscribeModel: (() => void) | null = null;

  constructor(options: LinkOptions) {
    this.#options = options;
    this.#retryMs = options.retry?.firstMs ?? 500;
    this.#state = {
      phase: 'connecting',
      detail: null,
      refusal: null,
      model: new SessionModel(),
      welcome: null,
      focus: null,
      problem: null,
      treeLoaded: false,
    };
  }

  get state(): LinkState {
    return this.#state;
  }

  /** The client id this link says `hello` with. */
  get clientId(): string {
    return this.#options.client;
  }

  subscribe(listener: (state: LinkState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #patch(partial: Partial<LinkState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const listener of this.#listeners) listener(this.#state);
  }

  start(): void {
    void this.#connect();
  }

  /** Try again now (after a final refusal, or to skip the backoff). */
  retry(): void {
    if (this.#disposed) return;
    this.#clearTimer();
    this.#retryMs = this.#options.retry?.firstMs ?? 500;
    this.#client?.close();
    this.#patch({ phase: 'connecting', detail: null, refusal: null });
    void this.#connect();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearTimer();
    this.#unsubscribeModel?.();
    this.#client?.close();
    this.#client = null;
  }

  /**
   * Make a call on the current connection. Rejects with `ConnectionClosed` when there is none
   * ready, and with the server's `ServeError` when it refuses.
   */
  call<M extends Method>(method: M, params: Requests[M]): Promise<Results[M]> {
    const client = this.#client;
    if (!client || this.#state.phase !== 'ready') {
      return Promise.reject(new ConnectionClosed(method, this.#state.detail ?? 'not connected'));
    }
    return client.call(method, params);
  }

  /** Follow `cursor`: watch its `Live`, keep its walk read. Null follows nothing. */
  focus(cursor: number | null): void {
    if (this.#state.focus === cursor) return;
    this.#patch({ focus: cursor });
    if (this.#state.phase === 'ready') {
      this.#watch();
      this.#follow();
    }
  }

  /**
   * Read the whole tree into the model, a page of `TREE_PAGE` nodes at a time. Ids are dense, so
   * a page shorter than asked for is the end; `Appended` keeps it whole after that.
   */
  async loadTree(): Promise<void> {
    if (this.#state.treeLoaded) return;
    const generation = this.#generation;
    const model = this.#state.model;
    let start = 0;
    for (;;) {
      const page = await this.call('nodes', { start, limit: TREE_PAGE });
      if (generation !== this.#generation) return; // a reconnect began again
      model.insert(page);
      if (page.length < TREE_PAGE) break;
      start += page.length;
    }
    this.#patch({ treeLoaded: true });
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #connect(): Promise<void> {
    if (this.#disposed) return;
    const generation = ++this.#generation;
    let transport: Transport;
    try {
      transport = await this.#options.open();
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) return;
      if (error instanceof EdgeError && !error.retryable) {
        this.#patch({ phase: 'failed', detail: error.message, refusal: error.kind });
      } else {
        this.#reconnectLater(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (generation !== this.#generation || this.#disposed) {
      transport.close();
      return;
    }

    const client = new ServeClient(transport);
    const model = new SessionModel();
    this.#client = client;
    this.#walking = null;
    this.#unsubscribeModel?.();
    this.#unsubscribeModel = model.subscribe(() => {
      if (generation === this.#generation) this.#follow();
    });
    client.on('event', (event) => {
      try {
        model.hear(event);
      } catch (error) {
        // A kind protocol 1 does not have: say so and drop the connection, loudly.
        this.#patch({ problem: (error as Error).message });
        client.close();
      }
    });
    client.on('closed', (reason, end) => {
      if (generation !== this.#generation || this.#disposed) return;
      this.#client = null;
      if (end?.error?.code === ERROR_CODES.CutOff) {
        // Fell behind: the snapshot of a new connection brings the client current. No wait.
        this.#patch({ phase: 'reconnecting', detail: `cut off (${reason}); reconnecting` });
        void this.#connect();
        return;
      }
      this.#reconnectLater(reason);
    });

    let welcome: Welcome;
    try {
      welcome = await client.hello(this.#options.client, this.#options.buffer);
    } catch (error) {
      if (generation !== this.#generation) return;
      if (error instanceof ServeError && error.is('ProtocolMismatch')) {
        client.close();
        this.#patch({
          phase: 'failed',
          refusal: 'protocol',
          detail: `the server refused this client's protocol: ${error.detail}. Use a tau-code built for this τ.`,
        });
      } else if (error instanceof ProtocolViolation || error instanceof ServeError) {
        client.close();
        this.#patch({ phase: 'failed', refusal: 'protocol', detail: error.message });
      }
      // ConnectionClosed: the `closed` handler is already reconnecting.
      return;
    }
    if (generation !== this.#generation) return;
    model.welcome = welcome;
    this.#retryMs = this.#options.retry?.firstMs ?? 500;
    const focus = this.#state.focus !== null && model.views.has(this.#state.focus) ? this.#state.focus : firstOpen(model);
    this.#patch({
      phase: 'ready',
      detail: null,
      refusal: null,
      model,
      welcome,
      focus,
      problem: null,
      treeLoaded: false,
    });
    this.#watch();
    this.#follow();
  }

  #reconnectLater(reason: string): void {
    if (this.#disposed) return;
    const wait = this.#retryMs;
    this.#retryMs = Math.min(this.#retryMs * 2, this.#options.retry?.maxMs ?? 10_000);
    this.#patch({ phase: this.#state.welcome ? 'reconnecting' : 'connecting', detail: reason });
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#connect();
    }, wait);
  }

  #watch(): void {
    const focus = this.#state.focus;
    this.#background(this.call('watch', { cursors: focus === null ? [] : [focus] }), 'watch');
  }

  /** Read the focused cursor's walk if the model does not hold it whole. One read at a time. */
  #follow(): void {
    const model = this.#state.model;
    const focus = this.#state.focus;
    if (this.#state.phase !== 'ready' || focus === null) return;
    if (!model.views.has(focus) && model.gone.has(focus)) {
      // Another client closed the cursor this one follows: follow the lowest open one, saying so.
      const next = firstOpen(model);
      this.focus(next); // first: the notice below runs this again, and must find the new focus
      model.notify(
        next === null ? `cursor ${focus} was closed` : `cursor ${focus} was closed; showing cursor ${next}`,
      );
      return;
    }
    const view = model.views.get(focus);
    if (!view || this.#walking === view.at || model.walk(view.at) !== null) return;
    const at = view.at;
    const generation = this.#generation;
    this.#walking = at;
    this.#background(
      this.call('walk', { id: at }).then((nodes) => {
        if (generation !== this.#generation) return;
        this.#walking = null;
        model.insert(nodes);
      }),
      'walk',
    );
  }

  #background(promise: Promise<unknown>, what: string): void {
    promise.catch((error: unknown) => {
      if (error instanceof ConnectionClosed) return; // the reconnect says so
      this.#patch({ problem: `${what} failed: ${error instanceof Error ? error.message : String(error)}` });
    });
  }
}

function firstOpen(model: SessionModel): number | null {
  return model.openCursors()[0]?.cursor ?? null;
}
