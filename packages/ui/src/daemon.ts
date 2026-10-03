import {
  CLOSE_NOTHING_TO_DIAL,
  CLOSE_TOO_FAR_BEHIND,
  ProtocolVersionError,
  ServeClient,
  ServeError,
  type HelloResult,
  type Transport,
} from '@ffwf/tau-code-protocol';
import { SessionStore } from './session.js';

/**
 * One head's link to `tau serve`: the connection, and the session it is on.
 *
 * Framework-agnostic, like the stores under it: React binds to it in
 * `useTau.ts`. A host hands it a way to OPEN a transport rather than a
 * transport, because a connection is one transport's lifetime and this object
 * outlives several -- a daemon restart, a laptop lid, the 4000 close the daemon
 * sends a client that fell too far behind.
 *
 * ## What reconnects, and what does not
 *
 * Fail Early is about not hiding a problem, not about refusing to retry one
 * that a retry can fix. A dropped socket is that kind: the session is the
 * daemon's, not this tab's, so nothing was lost and `attach` with the held
 * `epoch` and `since` brings the replica current -- a replay when the daemon
 * still has the events, a snapshot when it does not. The phase says
 * `reconnecting` the whole time, so the reader is never told it is connected
 * when it is not.
 *
 * Three refusals are final, because retrying them would repeat the same answer
 * forever: a protocol version mismatch, a missing or wrong token, and the host
 * itself saying there is nothing to dial (no τ installed, `tau serve -d`
 * failing) -- a relay closes with `CLOSE_NOTHING_TO_DIAL` for that. Each ends
 * in `failed` with τ's or the host's sentence, and `retry()` tries again once
 * the user has changed something.
 */

export type Phase = 'connecting' | 'ready' | 'reconnecting' | 'failed';

export interface DaemonState {
  phase: Phase;
  /** Why the phase is not `ready`, in a sentence. Null when it is. */
  detail: string | null;
  /** True when the daemon refused the token; the head asks for one. */
  needsToken: boolean;
  /** The session this head is attached to, or null before one is chosen. */
  session: SessionStore | null;
  /** The daemon's answer to `hello`: its version, pid and cwd. Null before one. */
  hello: HelloResult | null;
}

export interface DaemonOptions {
  /**
   * Open a new transport to the daemon. Called again for every reconnect. A
   * throw is final: the head shows its message and waits for `retry()`.
   */
  open: () => Transport;
  /** Names this head in the daemon's log. */
  client: string;
  /** The token to send in `hello`, or null for none. */
  token: string | null;
}

/** Backoff between reconnect attempts: 0.5s doubling to 10s. */
const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 10_000;

export class Daemon {
  #options: DaemonOptions;
  #state: DaemonState = { phase: 'connecting', detail: null, needsToken: false, session: null, hello: null };
  #listeners = new Set<(state: DaemonState) => void>();
  #client: ServeClient | null = null;
  #retryMs = RETRY_FIRST_MS;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(options: DaemonOptions) {
    this.#options = options;
  }

  get state(): DaemonState {
    return this.#state;
  }

  /** The live client, or null while there is none. Do not hold on to it. */
  get client(): ServeClient | null {
    return this.#state.phase === 'ready' ? this.#client : null;
  }

  subscribe(listener: (state: DaemonState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #patch(partial: Partial<DaemonState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const listener of this.#listeners) listener(this.#state);
  }

  start(): void {
    void this.#connect();
  }

  /** Try again now, with a new token if one was given. */
  retry(token?: string | null): void {
    if (token !== undefined) this.#options = { ...this.#options, token };
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#retryMs = RETRY_FIRST_MS;
    this.#patch({ phase: 'connecting', detail: null, needsToken: false });
    void this.#connect();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#state.session?.dispose();
    this.#client?.close();
  }

  async #connect(): Promise<void> {
    if (this.#disposed) return;
    let transport: Transport;
    try {
      transport = this.#options.open();
    } catch (error) {
      this.#patch({ phase: 'failed', detail: messageOf(error) });
      return;
    }
    const client = new ServeClient(transport);
    this.#client = client;
    client.on('close', (reason, code) => this.#closed(client, reason, code));

    let hello: HelloResult;
    try {
      hello = await client.hello(this.#options.client, this.#options.token);
    } catch (error) {
      if (client.closed && !(error instanceof ProtocolVersionError)) return; // #closed handles it
      if (error instanceof ServeError && error.code === 'unauthorized') {
        client.close();
        this.#patch({ phase: 'failed', detail: error.detail, needsToken: true });
        return;
      }
      client.close();
      this.#patch({ phase: 'failed', detail: messageOf(error) });
      return;
    }

    this.#retryMs = RETRY_FIRST_MS;
    const session = this.#state.session;
    if (session) {
      try {
        await session.reattach(client);
      } catch (error) {
        // The session may be gone (deleted, or the daemon's store moved). That
        // is not a connection problem, so the link stays up and the session
        // says why it is empty.
        session.fail(messageOf(error));
      }
    }
    this.#patch({ phase: 'ready', detail: null, needsToken: false, hello });
  }

  #closed(client: ServeClient, reason: string, code: number | null): void {
    if (this.#disposed || client !== this.#client) return;
    if (this.#state.phase === 'failed') return;
    if (code === CLOSE_NOTHING_TO_DIAL) {
      this.#patch({ phase: 'failed', detail: reason });
      return;
    }
    const behind = code === CLOSE_TOO_FAR_BEHIND;
    this.#patch({
      phase: 'reconnecting',
      detail: behind ? 'Catching up: this view fell behind the session and is resuming.' : reason,
    });
    const wait = behind ? 0 : this.#retryMs;
    this.#retryMs = Math.min(this.#retryMs * 2, RETRY_MAX_MS);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#connect();
    }, wait);
  }

  // ── sessions ─────────────────────────────────────────────────────────────

  /** Attach to `sessionId`, detaching from the one this head was on. */
  async open(sessionId: string): Promise<SessionStore> {
    const client = this.#require();
    const previous = this.#state.session;
    if (previous?.sessionId === sessionId) return previous;
    const session = new SessionStore(sessionId);
    await session.attach(client);
    if (previous) {
      previous.dispose();
      // Detaching is a courtesy to the daemon's log and its fan-out; a failure
      // here changes nothing this head shows, so it is reported to the console
      // and not to the reader.
      client.request('detach', { session_id: previous.sessionId }).catch((error: unknown) => {
        console.warn(`detach ${previous.sessionId} failed: ${messageOf(error)}`);
      });
    }
    this.#patch({ session });
    return session;
  }

  /** Create a session in `cwd` (a path on the daemon's machine) and attach to it. */
  async create(cwd: string, model: string | null = null): Promise<SessionStore> {
    const client = this.#require();
    const opened = await client.request('new_session', { cwd, ...(model ? { model } : {}) });
    if (opened.cancelled) throw new Error('An extension refused to start a session. Nothing was created.');
    return this.open(opened.session.session_id);
  }

  /**
   * Copy the current session's path, up to `at` (or this head's cursor's leaf),
   * into a new session, and attach to it.
   */
  async fork(at: string | null): Promise<SessionStore> {
    const session = this.#state.session;
    if (!session) throw new Error('There is no session to fork.');
    const { client, session_id, cursor_id } = session.at();
    const forked = await client.request('fork', { session_id, cursor_id, at });
    if (forked.cancelled) throw new Error('An extension refused the fork. Nothing was created.');
    return this.open(forked.session.session_id);
  }

  #require(): ServeClient {
    const client = this.client;
    if (!client) throw new Error(this.#state.detail ?? 'Not connected to tau serve.');
    return client;
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof ServeError) return error.detail;
  return error instanceof Error ? error.message : String(error);
}
