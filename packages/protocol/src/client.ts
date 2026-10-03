import { ProtocolVersionError, ServeError } from './errors.js';
import type { Transport } from './transport.js';
import { PROTOCOL_VERSION } from './generated.js';
import type {
  Error as WireError,
  Event,
  RequestFields,
  RequestType,
  Results,
} from './generated.js';

/**
 * The serve protocol version this client was generated against.
 *
 * Read off the generated file rather than written here: a literal is a second
 * copy of a number `npm run generate` already wrote.
 */
export const BUILT_AGAINST: string = PROTOCOL_VERSION;

export interface ServeClientEvents {
  /** One event for an attached session. */
  event: (event: Event) => void;
  /** A frame that is neither a response nor an event, or a response for no request. */
  protocolViolation: (detail: string, raw: unknown) => void;
  /** The peer is gone. */
  close: (reason: string, code: number | null) => void;
}

type Pending = {
  type: string;
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
};

/**
 * A client for one connection to `tau serve`.
 *
 * Deliberately thin. It numbers requests, correlates responses, routes events,
 * and enforces the one contract that is cheap now and expensive later:
 * **`hello` first**, naming the protocol version, and a refusal is final.
 *
 * It does not reconnect. A connection is one transport's lifetime; resuming is
 * the replica's job (`attach` with the held `epoch` and `since`), on a new
 * client over a new transport.
 *
 * There is no deadline on a request, on purpose: `submit` answers when the
 * submission ENDS, which is as long as a turn takes. The price is that a
 * request nobody will answer must be rejected some other way, and that way is
 * the transport closing -- every pending request is rejected with the close's
 * reason. A relay with nothing behind it closes; it never drops.
 */
export class ServeClient {
  #transport: Transport;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #listeners: { [K in keyof ServeClientEvents]: Set<ServeClientEvents[K]> } = {
    event: new Set(),
    protocolViolation: new Set(),
    close: new Set(),
  };
  /**
   * Why this connection ended, kept after the `close` event has been emitted.
   *
   * A close can happen before anyone is listening -- a relay that learns there
   * is no daemon while the page is still loading -- and the event is then
   * emitted to nobody. The reason is a permanent fact about this client, so it
   * is remembered and every later refusal is phrased with it.
   */
  #closedReason: string | null = null;
  #closed = false;

  constructor(transport: Transport) {
    this.#transport = transport;
    transport.onMessage((frame) => this.#receive(frame));
    transport.onClose((reason, code) => this.#handleClose(reason, code));
  }

  on<K extends keyof ServeClientEvents>(name: K, handler: ServeClientEvents[K]): () => void {
    this.#listeners[name].add(handler);
    return () => {
      this.#listeners[name].delete(handler);
    };
  }

  #emit<K extends keyof ServeClientEvents>(name: K, ...args: Parameters<ServeClientEvents[K]>): void {
    for (const handler of this.#listeners[name]) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }

  /**
   * Say `hello`, which the daemon serves before anything else.
   *
   * A `protocol_mismatch` refusal closes this client and throws
   * `ProtocolVersionError`; an `unauthorized` one throws the `ServeError` as it
   * is, because the caller can fix that one by asking for a token.
   */
  async hello(client: string, token: string | null): Promise<Results['hello']> {
    try {
      return await this.request('hello', { protocol: BUILT_AGAINST, client, token });
    } catch (error) {
      if (error instanceof ServeError && error.code === 'protocol_mismatch') {
        this.close();
        throw new ProtocolVersionError(BUILT_AGAINST, error.detail);
      }
      throw error;
    }
  }

  /** Send one request and await its response. */
  request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<Results[T]> {
    if (this.#closed) {
      // The reason, not the state. "The connection is closed" is the one thing
      // the caller can already see; what it cannot see is why.
      const why = this.#closedReason?.trim() || 'the connection is closed.';
      return Promise.reject(new Error(`Cannot send ${type}: ${why}`));
    }
    const id = this.#nextId++;
    return new Promise<Results[T]>((resolve, reject) => {
      this.#pending.set(id, { type, resolve: resolve as (v: never) => void, reject });
      this.#transport.send({ ...fields, type, id });
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): void {
    if (this.#closed) return;
    this.#transport.close();
    this.#handleClose('closed by this client', null);
  }

  #handleClose(reason: string, code: number | null): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closedReason = reason;
    for (const [, pending] of this.#pending) {
      pending.reject(new Error(`The connection closed before ${pending.type} answered: ${reason}`));
    }
    this.#pending.clear();
    this.#emit('close', reason, code);
  }

  #receive(frame: unknown): void {
    if (typeof frame !== 'object' || frame === null) {
      this.#emit('protocolViolation', 'frame is not an object', frame);
      return;
    }
    const record = frame as Record<string, unknown>;

    if (record['type'] === 'event') {
      this.#emit('event', frame as Event);
      return;
    }
    if (record['type'] !== 'response') {
      this.#emit('protocolViolation', `frame of unknown type ${JSON.stringify(record['type'])}`, frame);
      return;
    }

    const id = record['id'];
    const pending = typeof id === 'number' ? this.#pending.get(id) : undefined;
    if (!pending) {
      this.#emit('protocolViolation', `response for unknown id ${JSON.stringify(id)}`, frame);
      return;
    }
    this.#pending.delete(id as number);
    if (record['ok'] === true) {
      pending.resolve(record['result'] as never);
      return;
    }
    const error = record['error'] as WireError | null | undefined;
    if (!error) {
      pending.reject(new Error(`${pending.type} answered ok:false with no error.`));
      return;
    }
    pending.reject(new ServeError(pending.type, error));
  }
}
