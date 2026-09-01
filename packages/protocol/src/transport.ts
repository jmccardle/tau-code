/**
 * The transport seam.
 *
 * Everything above this file speaks whole JSON-RPC lines and knows nothing
 * about pipes, sockets, or `postMessage`. This is the same separation tau's own
 * `rpc/transport.py` keeps on its side (REMOTE-CONTROL.md X1), and it is what
 * lets one client serve three hosts:
 *
 *   - a child process over stdio      (the VS Code extension host, the server)
 *   - a WebSocket                     (the browser)
 *   - `postMessage`                   (the VS Code webview)
 */
export interface Transport {
  /** Send one complete JSON-RPC message. The transport adds any framing. */
  send(message: unknown): void;
  /** Register the sink for inbound messages. Called once. */
  onMessage(handler: (message: unknown) => void): void;
  /**
   * Register the "the peer is gone" sink. One named event with per-transport
   * detection: stdin EOF, a closed socket, a disposed webview (X2).
   */
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

/**
 * Reassembles LF-delimited JSON from arbitrarily-chunked input.
 *
 * **There is deliberately no maximum line length here.** tau's protocol doc is
 * explicit that a host must not impose one (T8): `get_capabilities` alone
 * answers with more than 64 KiB, and `get_messages` has no ceiling at all.
 * 64 KiB is the default limit in several stream readers, including Node's own
 * `readline` historically and Python's `asyncio.StreamReader` — the same number
 * and the same failure that tau's inbound `max_request_line_bytes` exists to
 * have fixed on its side.
 *
 * A malformed line is reported, not swallowed. The caller decides whether that
 * is fatal; this class never drops a line silently.
 */
export class LineFramer {
  #buffer = '';

  constructor(
    private readonly onValue: (value: unknown) => void,
    private readonly onMalformed: (line: string, error: unknown) => void,
  ) {}

  push(chunk: string): void {
    this.#buffer += chunk;
    let index: number;
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.trim() === '') continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        this.onMalformed(line, error);
        continue;
      }
      this.onValue(value);
    }
  }

  /**
   * Bytes held back because no LF has arrived yet. A non-empty value at close
   * means the peer died mid-line, which is worth reporting rather than
   * discarding.
   */
  get pending(): string {
    return this.#buffer;
  }
}

/** Serialize one message as a single LF-terminated line. */
export function frame(message: unknown): string {
  return JSON.stringify(message) + '\n';
}
