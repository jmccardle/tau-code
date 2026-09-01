import type { Transport } from '@tau-code/protocol';

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
 * WebSocket. `@tau-code/ui` cannot tell the difference, which is the point.
 *
 * No framing: `postMessage` delivers structured values, already whole. The line
 * framer exists for byte streams and there is no byte stream here.
 */
export class VsCodeTransport implements Transport {
  #onMessage: ((message: unknown) => void) | null = null;
  #onClose: ((reason: string) => void) | null = null;
  #closed = false;

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data;
      // The host reports a dead agent process out of band, because a stdio
      // transport has no close frame to send.
      if (
        typeof data === 'object' &&
        data !== null &&
        (data as Record<string, unknown>)['method'] === 'tau_code/process_exit'
      ) {
        const params = (data as Record<string, unknown>)['params'] as { reason?: string } | undefined;
        this.#fire(params?.reason ?? 'tau stopped.');
        return;
      }
      this.#onMessage?.(data);
    });
  }

  send(message: unknown): void {
    if (this.#closed) return;
    api().postMessage(message);
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#onMessage = handler;
  }

  onClose(handler: (reason: string) => void): void {
    this.#onClose = handler;
  }

  close(): void {
    // The webview does not own the process; the extension host does. Closing
    // here would be a lie, so it is a no-op and the host's disposal is what
    // actually stops tau.
  }

  #fire(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#onClose?.(reason);
  }
}
