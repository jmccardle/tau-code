import { EdgeError, type Transport } from '@ffwf/tau-code-protocol';
import type { FromWebview, PageState, ToWebview } from './messages.js';

/**
 * The webview's side of the relay.
 *
 * `acquireVsCodeApi()` may be called ONCE per page; a second call throws. So the page has one
 * `Relay`, which owns the API and the one `message` listener, and each connection is a
 * `RelayTransport` it hands out with a number. The host tags every message with that number, and
 * a message for a connection the page has moved on from is dropped here.
 *
 * `open()` resolves once the host has the stream open, and rejects with the `EdgeError` the host
 * met (or `unavailable` when there is no τ to start), so `SessionLink` retries what can change and
 * stops on what cannot, exactly as it does over HTTP in a browser.
 */

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface Opening {
  transport: RelayTransport;
  resolve: (transport: Transport) => void;
  reject: (error: Error) => void;
}

export class Relay {
  #api: VsCodeApi;
  #next = 1;
  #opening = new Map<number, Opening>();
  #open = new Map<number, RelayTransport>();

  constructor() {
    this.#api = acquireVsCodeApi();
    window.addEventListener('message', (event: MessageEvent<ToWebview>) => this.#hear(event.data));
  }

  #hear(message: ToWebview): void {
    switch (message.tauCode) {
      case 'opened': {
        const opening = this.#opening.get(message.connection);
        if (!opening) return;
        this.#opening.delete(message.connection);
        this.#open.set(message.connection, opening.transport);
        opening.resolve(opening.transport);
        return;
      }
      case 'refused': {
        const opening = this.#opening.get(message.connection);
        if (!opening) return;
        this.#opening.delete(message.connection);
        opening.reject(new EdgeError(message.kind, message.reason));
        return;
      }
      case 'message':
        this.#open.get(message.connection)?.deliver(message.message);
        return;
      case 'closed': {
        const transport = this.#open.get(message.connection) ?? this.#opening.get(message.connection)?.transport;
        const opening = this.#opening.get(message.connection);
        this.#open.delete(message.connection);
        this.#opening.delete(message.connection);
        opening?.reject(new EdgeError('unreachable', message.reason));
        transport?.closedByHost(message.reason, message.violation);
        return;
      }
    }
  }

  /** A new connection to the session's server, through the host. */
  open(): Promise<Transport> {
    const connection = this.#next++;
    const transport = new RelayTransport(connection, (message) => this.#api.postMessage(message), () => {
      this.#open.delete(connection);
      this.#opening.delete(connection);
    });
    const opened = new Promise<Transport>((resolve, reject) => {
      this.#opening.set(connection, { transport, resolve, reject });
    });
    this.#api.postMessage({ tauCode: 'open', connection });
    return opened;
  }

  /** Ask the host to run an editor command. */
  command(command: string): void {
    this.#api.postMessage({ tauCode: 'command', command });
  }

  get state(): PageState {
    const state = this.#api.getState();
    return state && typeof state === 'object' ? (state as PageState) : {};
  }

  /** Keep `patch` in webview state: the host reads it back to restore this panel. */
  remember(patch: PageState): void {
    const state = { ...this.state, ...patch };
    this.#api.setState(state);
  }
}

class RelayTransport implements Transport {
  #onMessage: ((message: unknown) => void) | null = null;
  /** Messages that arrived before `onMessage` was called. */
  #early: unknown[] = [];
  #onClose: ((reason: string, violation: boolean) => void) | null = null;
  #closed = false;
  /** A close that arrived before anyone listened; delivered on `onClose`. */
  #pendingClose: { reason: string; violation: boolean } | null = null;

  constructor(
    readonly connection: number,
    private readonly post: (message: FromWebview) => void,
    private readonly forget: () => void,
  ) {}

  deliver(message: unknown): void {
    if (this.#closed) return;
    if (this.#onMessage) this.#onMessage(message);
    else this.#early.push(message);
  }

  closedByHost(reason: string, violation: boolean): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#onClose) this.#onClose(reason, violation);
    else this.#pendingClose = { reason, violation };
  }

  send(message: object): void {
    // As `HttpTransport`: a send after the close is dropped, because the close was already
    // reported, and the client rejects every call that was waiting on it.
    if (this.#closed) return;
    this.post({ tauCode: 'message', connection: this.connection, message });
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#onMessage = handler;
    for (const message of this.#early.splice(0)) handler(message);
  }

  onClose(handler: (reason: string, violation: boolean) => void): void {
    this.#onClose = handler;
    const pending = this.#pendingClose;
    if (pending) {
      this.#pendingClose = null;
      handler(pending.reason, pending.violation);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.post({ tauCode: 'close', connection: this.connection });
    this.forget();
    // `Transport.close`: the close handler runs once, for this close too.
    this.#onClose?.('closed by this client', false);
  }
}
