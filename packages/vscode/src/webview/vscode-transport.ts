import type { Transport } from '@ffwf/tau-code-protocol';
import type { HostNotice } from '@ffwf/tau-code-ui';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * `acquireVsCodeApi` may be called exactly once per webview document. A second
 * call throws, and a webview that hot-reloads or mounts twice under React
 * StrictMode would do exactly that, so the handle is cached here.
 */
let cached: VsCodeApi | null = null;
function api(): VsCodeApi {
  cached ??= acquireVsCodeApi();
  return cached;
}

/**
 * A `Transport` over the webview's `postMessage` channel.
 *
 * The extension host relays these to tau's stdin verbatim, so what travels here
 * is ordinary JSON-RPC -- the same messages the browser sends over a
 * WebSocket. `@ffwf/tau-code-ui` cannot tell the difference, which is the
 * point.
 *
 * No framing: `postMessage` delivers structured values, already whole. The line
 * framer exists for byte streams and there is no byte stream here.
 */
export class VsCodeTransport implements Transport {
  #onMessage: ((message: unknown) => void) | null = null;
  #onClose: ((reason: string) => void) | null = null;
  #onNotice: ((notice: HostNotice) => void) | null = null;
  #closed = false;
  /**
   * A close that arrived before anybody was listening for one.
   *
   * The window listener is attached in this constructor, but `onClose` is
   * registered later, when `TauClient` is built. Anything the host says in
   * between used to be dropped -- and `tau_code/process_exit` is exactly what
   * the host says in that window when a restart's OLD process dies while the
   * NEW page is still booting. The transport marked itself closed, nothing was
   * told, and `send` then refused every request in silence: `connect()` never
   * resolved and never rejected, so the panel read "connecting" forever.
   */
  #pendingClose: string | null = null;

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data;
      const method =
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)['method']
          : undefined;

      // The host reports a dead agent process out of band, because a stdio
      // transport has no close frame to send.
      if (method === 'tau_code/process_exit') {
        const params = (data as Record<string, unknown>)['params'] as { reason?: string } | undefined;
        this.#fire(params?.reason ?? 'tau stopped.');
        return;
      }

      // Something the HOST knows and tau does not -- which tau it picked, and
      // what else it found. It cannot arrive on the protocol channel, because
      // the process the protocol describes is the subject of the sentence.
      if (method === 'tau_code/notice') {
        const params = (data as Record<string, unknown>)['params'] as HostNotice | undefined;
        if (params) this.#onNotice?.(params);
        return;
      }

      this.#onMessage?.(data);
    });
  }

  /** Host sentences for the banner strip. Not part of `Transport`. */
  onNotice(handler: (notice: HostNotice) => void): void {
    this.#onNotice = handler;
  }

  send(message: unknown): void {
    // Throwing, not returning. `TauClient.call` sends inside a Promise executor,
    // so this rejects that one call with a sentence; swallowing it left the
    // request pending forever, and a request that never settles is the one
    // failure a UI cannot render. The host is the only thing that can restart
    // tau, so there is nothing to retry here and nothing to queue.
    if (this.#closed) {
      throw new Error('tau is not running, so nothing can be sent to it.');
    }
    api().postMessage(message);
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#onMessage = handler;
  }

  onClose(handler: (reason: string) => void): void {
    this.#onClose = handler;
    // Say the thing that was said while nobody was listening. Delivered once:
    // a close is a fact about the connection, not a message queue.
    const pending = this.#pendingClose;
    if (pending !== null) {
      this.#pendingClose = null;
      handler(pending);
    }
  }

  close(): void {
    // The webview does not own the process; the extension host does. Closing
    // here would be a lie, so it is a no-op and the host's disposal is what
    // actually stops tau.
  }

  #fire(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#onClose) {
      this.#onClose(reason);
      return;
    }
    this.#pendingClose = reason;
  }
}
