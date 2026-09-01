import { LineFramer, type Transport } from '@tau-code/protocol';

/**
 * A `Transport` over a WebSocket to `@tau-code/server`.
 *
 * The server relays JSON-RPC lines to and from tau essentially unchanged, so
 * the client above this is the same one the VS Code extension host uses. The
 * browser's only extra job is the token.
 *
 * Messages arrive as whole frames in practice, but the framer is used anyway:
 * the server writes LF-terminated lines and a frame boundary is not a promise
 * the WebSocket protocol makes about line boundaries.
 */
export class WebSocketTransport implements Transport {
  #socket: WebSocket;
  #framer: LineFramer;
  #onMessage: ((message: unknown) => void) | null = null;
  #onClose: ((reason: string) => void) | null = null;
  #queue: string[] = [];
  #open = false;
  #closed = false;

  constructor(url: string, onViolation?: (detail: string) => void) {
    this.#framer = new LineFramer(
      (value) => this.#onMessage?.(value),
      (line, error) => onViolation?.(`unparseable line (${String(error)}): ${line.slice(0, 400)}`),
    );

    this.#socket = new WebSocket(url);

    this.#socket.addEventListener('open', () => {
      this.#open = true;
      for (const line of this.#queue) this.#socket.send(line);
      this.#queue = [];
    });

    this.#socket.addEventListener('message', (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : '';
      // The framer needs a trailing newline to emit; the server sends one, but
      // a frame that arrives without it would otherwise sit in the buffer.
      this.#framer.push(data.endsWith('\n') ? data : `${data}\n`);
    });

    this.#socket.addEventListener('close', (event: CloseEvent) => {
      this.#fire(describeClose(event));
    });

    this.#socket.addEventListener('error', () => {
      // The `close` event always follows and carries the code, so the reason is
      // reported there rather than twice.
      if (!this.#open && !this.#closed) {
        this.#fire(
          'Could not open the connection. Check that the server is running and that the URL still carries a valid token.',
        );
      }
    });
  }

  send(message: unknown): void {
    if (this.#closed) return;
    const line = JSON.stringify(message) + '\n';
    if (this.#open) this.#socket.send(line);
    else this.#queue.push(line);
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#onMessage = handler;
  }

  onClose(handler: (reason: string) => void): void {
    this.#onClose = handler;
  }

  close(): void {
    if (this.#closed) return;
    this.#socket.close(1000, 'client closed');
  }

  #fire(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#onClose?.(reason);
  }
}

function describeClose(event: CloseEvent): string {
  if (event.code === 1000 || event.code === 1001) return 'The connection was closed.';
  if (event.code === 1011) return event.reason || 'tau stopped.';
  return `The connection closed (code ${event.code}${event.reason ? `: ${event.reason}` : ''}).`;
}

/**
 * Build the WebSocket URL for this page, carrying the token forward.
 *
 * The server prints an authenticated URL and the token rides in the query
 * string, exactly as Jupyter does. The page reuses whatever token got it here
 * rather than asking for it again.
 */
export function socketUrlFromLocation(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = new URLSearchParams(location.search).get('token') ?? '';
  return `${scheme}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
