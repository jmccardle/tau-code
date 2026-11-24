import { ConnectionClosed, ProtocolViolation, ServeError } from './errors.js';
import { PROTOCOL } from './generated.js';
import type { End, Error as WireError, Event, Method, Requests, Results, Welcome } from './generated.js';
import type { Transport } from './transport.js';

export interface ServeClientHandlers {
  /** One `event` notification's params. */
  event: (event: Event) => void;
  /**
   * The connection is gone. `end` is the server's last message when it sent one (`error` null: the
   * server stopped; `CutOff`: this client fell behind; `Stopped`: the driver failed), else null (a
   * drop, or this client closed).
   */
  closed: (reason: string, end: End | null) => void;
}

interface Pending {
  method: string;
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
}

/** How `end` reads, for a person. */
export function describeEnd(end: End): string {
  if (end.error === null) return 'the server stopped';
  return `${end.error.message} (${end.error.code})`;
}

/**
 * A JSON-RPC client for one connection to `tau serve` (protocol 1).
 *
 * It numbers requests, matches answers by `id`, hands each `event` notification up, and keeps the
 * one contract the wire has before anything else: `hello` first, naming `PROTOCOL`. A server
 * speaking another protocol refuses with `ProtocolMismatch`, a `ServeError`; that is final.
 *
 * There is no deadline on a call, on purpose: `run` answers when its command finishes. A call
 * nobody will answer is rejected when the connection closes, with `ConnectionClosed` and why.
 * It does not reconnect (there is no resume): `SessionLink` makes a new client for that.
 *
 * Anything the server sends that protocol 1 does not allow closes the connection, naming it.
 */
export class ServeClient {
  readonly #transport: Transport;
  #nextId = 0;
  readonly #pending = new Map<number, Pending>();
  readonly #handlers: { [K in keyof ServeClientHandlers]: Set<ServeClientHandlers[K]> } = {
    event: new Set(),
    closed: new Set(),
  };
  #end: End | null = null;
  #closedReason: string | null = null;

  constructor(transport: Transport) {
    this.#transport = transport;
    transport.onMessage((message) => this.#receive(message));
    transport.onClose((reason) => this.#closed(reason));
  }

  on<K extends keyof ServeClientHandlers>(name: K, handler: ServeClientHandlers[K]): () => void {
    this.#handlers[name].add(handler);
    return () => {
      this.#handlers[name].delete(handler);
    };
  }

  /** Why the connection closed, or null while it is open. */
  get closedReason(): string | null {
    return this.#closedReason;
  }

  /** The server's `end`, once it has sent one. */
  get end(): End | null {
    return this.#end;
  }

  /**
   * Say `hello`: the first call of a connection. Its snapshot events (every cursor's
   * `CursorView` or `CursorGone`, then `Labels`) arrive before it resolves.
   *
   * `client` is this client's stable id (`john@laptop:vscode`): questions can be addressed to it
   * and its input is written as `Frontend(client)`. `buffer` is the event buffer the server keeps
   * for it (the server's default when left out).
   */
  hello(client: string, buffer?: number): Promise<Welcome> {
    const params: Requests['hello'] = { protocol: PROTOCOL, client };
    if (buffer !== undefined) params.buffer = buffer;
    return this.call('hello', params);
  }

  /** Make one call and await its answer. Rejects with `ServeError` or `ConnectionClosed`. */
  call<M extends Method>(method: M, params: Requests[M]): Promise<Results[M]> {
    if (this.#closedReason !== null) return Promise.reject(new ConnectionClosed(method, this.#closedReason));
    const id = this.#nextId++;
    return new Promise<Results[M]>((resolve, reject) => {
      this.#pending.set(id, { method, resolve: resolve as (value: never) => void, reject });
      this.#transport.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Close the connection. `close` is not a call in protocol 1: a client just goes. */
  close(): void {
    this.#transport.close();
  }

  #emit<K extends keyof ServeClientHandlers>(name: K, ...args: Parameters<ServeClientHandlers[K]>): void {
    for (const handler of this.#handlers[name]) (handler as (...a: unknown[]) => void)(...args);
  }

  #closed(reason: string): void {
    if (this.#closedReason !== null) return;
    const why = this.#end ? describeEnd(this.#end) : reason;
    this.#closedReason = why;
    for (const pending of this.#pending.values()) pending.reject(new ConnectionClosed(pending.method, why));
    this.#pending.clear();
    this.#emit('closed', why, this.#end);
  }

  #violation(detail: string): void {
    // The transport's close handler rejects what is pending and reports the reason.
    this.#closed(new ProtocolViolation(detail).message);
    this.#transport.close();
  }

  #receive(message: unknown): void {
    if (this.#closedReason !== null) return;
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      this.#violation(`a message is not an object: ${JSON.stringify(message)}`);
      return;
    }
    const record = message as Record<string, unknown>;
    if (record['jsonrpc'] !== '2.0') {
      this.#violation(`a message is not JSON-RPC 2.0: ${JSON.stringify(message).slice(0, 200)}`);
      return;
    }
    if (!('id' in record)) {
      this.#notification(record);
      return;
    }
    const id = record['id'];
    const pending = typeof id === 'number' ? this.#pending.get(id) : undefined;
    if (!pending) {
      const error = record['error'] as WireError | undefined;
      const said = error ? ` (${error.code}: ${error.message})` : '';
      this.#violation(`an answer to no call, id ${JSON.stringify(id)}${said}`);
      return;
    }
    this.#pending.delete(id as number);
    if ('error' in record) {
      let error: ServeError;
      try {
        error = new ServeError(pending.method, record['error'] as WireError);
      } catch (violation) {
        pending.reject(violation);
        this.#violation((violation as Error).message);
        return;
      }
      pending.reject(error);
    } else if ('result' in record) {
      pending.resolve(record['result'] as never);
    } else {
      pending.reject(new ProtocolViolation(`${pending.method} was answered with neither a result nor an error`));
    }
  }

  #notification(record: Record<string, unknown>): void {
    const params = record['params'];
    if (typeof params !== 'object' || params === null) {
      this.#violation(`notification ${JSON.stringify(record['method'])} has no params object`);
      return;
    }
    switch (record['method']) {
      case 'event':
        this.#emit('event', params as Event);
        return;
      case 'end':
        // The last message; the server closes the stream next, and `#closed` reports it.
        this.#end = params as End;
        return;
      default:
        this.#violation(`a notification of unknown method ${JSON.stringify(record['method'])}`);
    }
  }
}
