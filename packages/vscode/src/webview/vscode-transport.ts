import type { Transport } from '@ffwf/tau-code-protocol';
import type { FromWebview, HostNotice, ToWebview } from './messages.js';

/**
 * The webview's side of the relay.
 *
 * `acquireVsCodeApi()` may be called ONCE per page; a second call throws. So
 * the page has one `Relay`, which owns the API and the one `message` listener,
 * and each connection is a `RelayTransport` it hands out with a number. The
 * host tags every frame with that number, and a frame for a connection the
 * page has moved on from is dropped here.
 */

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export class Relay {
  #api: VsCodeApi;
  #next = 1;
  #connections = new Map<number, RelayTransport>();
  #onNotice: ((notice: HostNotice) => void) | null = null;
  #notices: HostNotice[] = [];

  constructor() {
    this.#api = acquireVsCodeApi();
    window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      switch (message.tauCode) {
        case 'frame':
          this.#connections.get(message.connection)?.deliver(message.frame);
          return;
        case 'closed':
          this.#connections.get(message.connection)?.closedByHost(message.reason, message.code);
          this.#connections.delete(message.connection);
          return;
        case 'notice':
          if (this.#onNotice) this.#onNotice(message.notice);
          else this.#notices.push(message.notice);
          return;
      }
    });
  }

  /** A new connection to the daemon, through the host. */
  open(): Transport {
    const connection = this.#next++;
    const transport = new RelayTransport(connection, (message) => this.#api.postMessage(message), () =>
      this.#connections.delete(connection),
    );
    this.#connections.set(connection, transport);
    this.#api.postMessage({ tauCode: 'open', connection });
    return transport;
  }

  /** Notices the host sent, including any sent before this was registered. */
  onNotice(handler: (notice: HostNotice) => void): void {
    this.#onNotice = handler;
    for (const notice of this.#notices.splice(0)) handler(notice);
  }

  /** Ask the host to run an editor command. */
  command(command: string, argument?: string): void {
    this.#api.postMessage({ tauCode: 'command', command, ...(argument === undefined ? {} : { argument }) });
  }

  /** Tell the host which daemon answered, so it can compare it with the τ it would start. */
  reportDaemon(version: string, pid: number): void {
    this.#api.postMessage({ tauCode: 'daemon', version, pid });
  }

  /** The session this page was on, so a restored tab re-attaches to it. */
  get rememberedSession(): string | null {
    const state = this.#api.getState() as { sessionId?: unknown } | null;
    return typeof state?.sessionId === 'string' ? state.sessionId : null;
  }

  remember(sessionId: string | null): void {
    this.#api.setState({ sessionId });
  }
}

class RelayTransport implements Transport {
  #onMessage: ((frame: unknown) => void) | null = null;
  #onClose: ((reason: string, code: number | null) => void) | null = null;
  #closed = false;
  /** A close that arrived before anyone listened; delivered on `onClose`. */
  #pendingClose: { reason: string; code: number | null } | null = null;

  constructor(
    readonly connection: number,
    private readonly post: (message: FromWebview) => void,
    private readonly forget: () => void,
  ) {}

  deliver(frame: unknown): void {
    if (!this.#closed) this.#onMessage?.(frame);
  }

  closedByHost(reason: string, code: number | null): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#onClose) this.#onClose(reason, code);
    else this.#pendingClose = { reason, code };
  }

  send(frame: unknown): void {
    // Throwing, not returning: the client sends inside a Promise executor, so
    // this rejects that one request with a sentence. Swallowing it would leave
    // the request pending forever.
    if (this.#closed) throw new Error('The connection to tau serve is closed.');
    this.post({ tauCode: 'frame', connection: this.connection, frame });
  }

  onMessage(handler: (frame: unknown) => void): void {
    this.#onMessage = handler;
  }

  onClose(handler: (reason: string, code: number | null) => void): void {
    this.#onClose = handler;
    const pending = this.#pendingClose;
    if (pending) {
      this.#pendingClose = null;
      handler(pending.reason, pending.code);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.post({ tauCode: 'close', connection: this.connection });
    this.forget();
  }
}
