import { ProtocolVersionError, RpcErrorCode, TauRpcError, type RpcErrorObject } from './errors.js';
import type { Transport } from './transport.js';
import { uiMethodsOf } from './capabilities.js';
import type { Capabilities, CommandName, CommandParams, CommandResult, WireEvent } from './generated.js';

/** The protocol MAJOR.MINOR this client was generated against. */
export const BUILT_AGAINST = '1.4';

/**
 * A `compaction_end` notification. It is NOT an `event`: it is its own method
 * with its own params shape, correlated by both `compaction_id` and
 * `request_id`. A client that treats every non-`event` notification as a
 * protocol violation drops it and sees `compact` never finish.
 */
export interface CompactionEnd {
  compaction_id: string;
  request_id?: number | string | null;
  performed?: boolean;
  cancelled?: boolean;
  [key: string]: unknown;
}

export interface TauClientEvents {
  /** One agent lifecycle event. Ten types; see `WireEvent`. */
  event: (event: WireEvent) => void;
  /** The deferred completion of a `compact` call. */
  compactionEnd: (params: CompactionEnd) => void;
  /** A notification whose method this client does not know. Additive MINOR. */
  unknownNotification: (method: string, params: unknown) => void;
  /** A line that did not parse, or a message that is not a JSON-RPC shape. */
  protocolViolation: (detail: string, raw: unknown) => void;
  /** The peer is gone. */
  close: (reason: string) => void;
}

type Pending = {
  method: string;
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
};

/**
 * A JSON-RPC 2.0 client for tau.
 *
 * Deliberately thin. It correlates requests, routes notifications, and enforces
 * three contracts that are cheap now and expensive to retrofit:
 *
 *  - **Version negotiation** (Fail Early). `connect()` calls `get_capabilities`
 *    first and refuses on a MAJOR mismatch.
 *  - **RC1** — a server-originated request is ANSWERED, at minimum with
 *    `METHOD_NOT_FOUND`. tau's reverse channel does not exist yet
 *    (`ui_methods` is `[]`), and a client that silently ignores the request
 *    when it arrives would hang the agent. Answering lets tau fail fast.
 *  - **RC2** — server ids live in their own namespace. This client's ids are
 *    positive integers, so an inbound id never collides with one of ours.
 *
 * It does NOT cache the session cursor. F3: no host may cache "the tip". Every
 * mutating response carries the resulting cursor and callers must re-read it.
 */
export class TauClient {
  #transport: Transport;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #listeners: { [K in keyof TauClientEvents]: Set<TauClientEvents[K]> } = {
    event: new Set(),
    compactionEnd: new Set(),
    unknownNotification: new Set(),
    protocolViolation: new Set(),
    close: new Set(),
  };
  #capabilities: Capabilities | null = null;
  #closed = false;

  constructor(transport: Transport) {
    this.#transport = transport;
    transport.onMessage((message) => this.#receive(message));
    transport.onClose((reason) => this.#handleClose(reason));
  }

  on<K extends keyof TauClientEvents>(name: K, handler: TauClientEvents[K]): () => void {
    this.#listeners[name].add(handler);
    return () => {
      this.#listeners[name].delete(handler);
    };
  }

  #emit<K extends keyof TauClientEvents>(name: K, ...args: Parameters<TauClientEvents[K]>): void {
    for (const handler of this.#listeners[name]) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }

  /**
   * Negotiate and return capabilities.
   *
   * tau's own instruction: call this first on every new connection, before any
   * mutating command, and refuse on a MAJOR mismatch rather than discovering it
   * on the first failing request.
   */
  async connect(): Promise<Capabilities> {
    const caps = await this.call('get_capabilities', {});
    const theirs = caps.protocol_version;
    const ourMajor = BUILT_AGAINST.split('.')[0];
    const theirMajor = String(theirs).split('.')[0];
    if (ourMajor !== theirMajor) {
      this.close();
      throw new ProtocolVersionError(BUILT_AGAINST, String(theirs));
    }
    this.#capabilities = caps;
    return caps;
  }

  /** Capabilities from the last `connect()`, or null before one. */
  get capabilities(): Capabilities | null {
    return this.#capabilities;
  }

  /**
   * Whether this connection has a reverse channel. `false` against every tau
   * shipped so far; the check exists so a feature can be gated on the answer
   * instead of on a version number.
   */
  get hasReverseChannel(): boolean {
    const caps = this.#capabilities;
    return caps !== null && uiMethodsOf(caps).length > 0;
  }

  /** Send one request and await its response. */
  call<M extends CommandName>(method: M, params: CommandParams<M>): Promise<CommandResult<M>> {
    if (this.#closed) {
      return Promise.reject(new Error(`Cannot call ${method}: the connection is closed.`));
    }
    const id = this.#nextId++;
    return new Promise<CommandResult<M>>((resolve, reject) => {
      this.#pending.set(id, { method, resolve: resolve as (v: never) => void, reject });
      this.#transport.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#transport.close();
    this.#handleClose('closed by this client');
  }

  #handleClose(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [, pending] of this.#pending) {
      pending.reject(new Error(`Connection closed before ${pending.method} answered: ${reason}`));
    }
    this.#pending.clear();
    this.#emit('close', reason);
  }

  #receive(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      this.#emit('protocolViolation', 'message is not an object', message);
      return;
    }
    const m = message as Record<string, unknown>;

    // A server-originated REQUEST: has both `method` and `id`. The reverse
    // channel does not exist yet, so the only correct answer is
    // METHOD_NOT_FOUND -- and answering at all is the whole point (RC1).
    if (typeof m['method'] === 'string' && m['id'] !== undefined && m['id'] !== null) {
      this.#answerUnsupported(m['id'], m['method'] as string);
      return;
    }

    // A NOTIFICATION: `method`, no `id`.
    if (typeof m['method'] === 'string') {
      const method = m['method'] as string;
      if (method === 'event') {
        this.#emit('event', m['params'] as WireEvent);
      } else if (method === 'compaction_end') {
        this.#emit('compactionEnd', m['params'] as CompactionEnd);
      } else {
        this.#emit('unknownNotification', method, m['params']);
      }
      return;
    }

    // A RESPONSE: correlated by id.
    const id = m['id'];
    if (typeof id !== 'number') {
      this.#emit('protocolViolation', 'response has no numeric id', message);
      return;
    }
    const pending = this.#pending.get(id);
    if (!pending) {
      this.#emit('protocolViolation', `response for unknown id ${id}`, message);
      return;
    }
    this.#pending.delete(id);
    if (m['error'] !== undefined) {
      pending.reject(new TauRpcError(pending.method, m['error'] as RpcErrorObject));
      return;
    }
    pending.resolve(m['result'] as never);
  }

  #answerUnsupported(id: unknown, method: string): void {
    this.#transport.send({
      jsonrpc: '2.0',
      id,
      error: {
        code: RpcErrorCode.METHOD_NOT_FOUND,
        message:
          `This client implements no reverse-channel methods (RC1). ` +
          `Method '${method}' is not supported.`,
      },
    });
  }
}
