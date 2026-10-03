import type { Transport } from '@ffwf/tau-code-protocol';

/**
 * The browser's transport: one WebSocket to `tau serve`.
 *
 * The serve protocol is one JSON object per text frame, so there is nothing to
 * reassemble -- a frame that does not parse is reported and dropped, never
 * guessed at.
 *
 * Frames sent before the socket opens are queued, because the client says
 * `hello` in the same tick it is built and the socket is not open yet.
 */
export class WebSocketTransport implements Transport {
  #socket: WebSocket;
  #onMessage: ((frame: unknown) => void) | null = null;
  #onClose: ((reason: string, code: number | null) => void) | null = null;
  #queue: string[] = [];
  #open = false;
  #closed = false;

  constructor(url: string, onViolation?: (detail: string) => void) {
    this.#socket = new WebSocket(url);

    this.#socket.addEventListener('open', () => {
      this.#open = true;
      for (const frame of this.#queue) this.#socket.send(frame);
      this.#queue = [];
    });

    this.#socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        onViolation?.('a binary frame arrived; the serve protocol sends text frames only');
        return;
      }
      let frame: unknown;
      try {
        frame = JSON.parse(event.data);
      } catch (error) {
        onViolation?.(`unparseable frame (${String(error)}): ${event.data.slice(0, 400)}`);
        return;
      }
      this.#onMessage?.(frame);
    });

    this.#socket.addEventListener('close', (event: CloseEvent) => {
      this.#fire(this.#open ? describeClose(event) : couldNotOpen(url), event.code);
    });
  }

  send(frame: unknown): void {
    if (this.#closed) return;
    const text = JSON.stringify(frame);
    if (this.#open) this.#socket.send(text);
    else this.#queue.push(text);
  }

  onMessage(handler: (frame: unknown) => void): void {
    this.#onMessage = handler;
  }

  onClose(handler: (reason: string, code: number | null) => void): void {
    this.#onClose = handler;
  }

  close(): void {
    if (this.#closed) return;
    this.#socket.close(1000, 'client closed');
  }

  #fire(reason: string, code: number | null): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#onClose?.(reason, code);
  }
}

/**
 * A socket that never opened. The browser hides why -- a refused port, a 403
 * from the daemon's Origin check, and a TLS failure all look the same from a
 * page -- so the sentence names the address and the two causes worth checking.
 */
function couldNotOpen(url: string): string {
  return (
    `Could not connect to ${url}. Check that \`tau serve\` is running there, and, if this page ` +
    `is served from somewhere else, that its origin is in the daemon's serve.allowed_origins.`
  );
}

function describeClose(event: CloseEvent): string {
  if (event.code === 1000 || event.code === 1001) return 'The daemon closed the connection.';
  return `The connection closed (code ${event.code}${event.reason ? `: ${event.reason}` : ''}).`;
}

/**
 * Where this page's daemon is: the host that served it.
 *
 * `tau serve` hosts the web client from `serve.web_root` on the same port as
 * its socket, so the page and the socket are one origin and the daemon's
 * Origin check passes with nothing configured. A `?daemon=HOST:PORT` query
 * dials somewhere else instead -- a Vite dev server on :5173, say -- and that
 * origin then has to be in the daemon's `serve.allowed_origins`.
 */
export function socketUrlFromLocation(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const override = new URLSearchParams(location.search).get('daemon');
  return `${scheme}//${override ?? location.host}/`;
}

/** The token this page was opened with, or null. It goes in `hello`, not the URL. */
export function tokenFromLocation(): string | null {
  return new URLSearchParams(location.search).get('token');
}
