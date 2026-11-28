/**
 * The transport seam.
 *
 * Everything above this file speaks whole JSON-RPC messages, one object each, and knows nothing
 * about HTTP. Protocol 2 has two transports (D29): a WebSocket on a Unix socket, which a browser
 * cannot dial, and the HTTP edge, which `HttpTransport` speaks. A host that relays messages (an
 * editor's extension host, later) implements this interface too.
 *
 * A transport is one connection's lifetime. It does not reconnect: there is no resume in protocol
 * 1, so a new connection is a new transport, a new `hello` and a fresh snapshot (`SessionLink`).
 */
export interface Transport {
  /** Send one message. Messages arrive at the server in the order they were sent. */
  send(message: object): void;
  /** Register the sink for inbound messages, parsed. Called once. */
  onMessage(handler: (message: unknown) => void): void;
  /**
   * Register the sink for "the connection is gone", with why, as a sentence. `violation` is true
   * when the transport closed because the server sent something protocol 3 does not allow: a
   * retry would meet the same server, so it is final. Called once.
   */
  onClose(handler: (reason: string, violation: boolean) => void): void;
  /** Close the connection. Idempotent; the close handler runs once. */
  close(): void;
}
