import { EdgeError } from './errors.js';
import type { Transport } from './transport.js';

/** How long opening the stream (up to its connection id), or one small POST, may take. τ's own client uses 10 s. */
export const CONNECT_MS = 10_000;

export interface HttpTransportOptions {
  /**
   * The edge's root: `http://127.0.0.1:3393/` from a serve record, or a page's own origin. The
   * stream is `<url>stream`, each request a POST to `<url>stream/<connection id>`.
   */
  url: string;
  /**
   * The bearer token (the serve record's `token`), or null to send no `Authorization` at all:
   * for a same-origin proxy that adds it (the dev server). A server that wants one answers 401,
   * which is reported, never guessed around.
   */
  token: string | null;
  /** The `fetch` to use. Both browsers and Node >= 20 have one; a test passes its own. */
  fetch?: typeof fetch;
  /** Overrides `CONNECT_MS`. */
  connectMs?: number;
}

/** One server-sent event: its type (`message` unless an `event:` field named one) and its data. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * The text/event-stream format, incrementally: `feed` takes decoded text as it arrives and returns
 * every event it completed. Comments (`: ping`, the edge's heartbeat) are dropped; `id:` and
 * `retry:` are read past, since the protocol has no resume (D29 §2).
 */
export class SseParser {
  #buffer = '';
  #event = 'message';
  #data: string[] = [];

  feed(text: string): SseEvent[] {
    this.#buffer += text;
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.#buffer);
      if (!match) break;
      // A lone `\r` at the end may be the first half of `\r\n`: wait for the next chunk.
      if (match[0] === '\r' && match.index === this.#buffer.length - 1) break;
      const line = this.#buffer.slice(0, match.index);
      this.#buffer = this.#buffer.slice(match.index + match[0].length);
      const event = this.#line(line);
      if (event) events.push(event);
    }
    return events;
  }

  #line(line: string): SseEvent | null {
    if (line === '') {
      const event = this.#data.length ? { event: this.#event, data: this.#data.join('\n') } : null;
      this.#event = 'message';
      this.#data = [];
      return event;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.#data.push(value);
    else if (field === 'event') this.#event = value;
    return null;
  }
}

/**
 * A connection to τ's HTTP edge (D29): `GET /stream` read as server-sent events over `fetch` and a
 * `ReadableStream` (so it can carry `Authorization`, which `EventSource` cannot), and each message
 * sent as `POST /stream/<connection id>`.
 *
 * POSTs go one at a time, each after the last was accepted (202): the server begins calls in the
 * order their POSTs arrive, and two in flight could arrive in either order. A POST that fails, or
 * is answered with anything but 202, fails the whole connection, as τ's Python client does: the
 * request may or may not have arrived, and going on with a call lost would be worse.
 *
 * The same code runs in a browser and in Node >= 20.
 */
export class HttpTransport implements Transport {
  readonly id: string;
  readonly #url: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch;
  readonly #connectMs: number;
  readonly #abort: AbortController;
  #onMessage: ((message: unknown) => void) | null = null;
  /** Messages that arrived before `onMessage` was called, handed over when it is. */
  #early: unknown[] = [];
  #onClose: (reason: string, violation: boolean) => void = () => {};
  #queue: Promise<void> = Promise.resolve();
  #closed = false;
  /** Why, when the transport closed before anyone registered `onClose`. */
  #closedReason: string | null = null;
  #violation = false;

  private constructor(
    url: string,
    headers: Record<string, string>,
    fetchImpl: typeof fetch,
    connectMs: number,
    abort: AbortController,
    id: string,
  ) {
    this.#url = url;
    this.#headers = headers;
    this.#fetch = fetchImpl;
    this.#connectMs = connectMs;
    this.#abort = abort;
    this.id = id;
  }

  /**
   * Open a stream and read its connection id. Throws `EdgeError`: `unreachable` if nothing
   * answers in time, `unauthorized` for 401, `forbidden` for 403, `not-an-edge` for anything
   * else that is not τ's event stream.
   */
  static async open(options: HttpTransportOptions): Promise<HttpTransport> {
    const url = options.url.endsWith('/') ? options.url : `${options.url}/`;
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    const connectMs = options.connectMs ?? CONNECT_MS;
    const headers: Record<string, string> = {};
    if (options.token !== null) headers['Authorization'] = `Bearer ${options.token}`;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), connectMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(new URL('stream', url), {
          headers: { ...headers, Accept: 'text/event-stream' },
          signal: abort.signal,
          cache: 'no-store',
        });
      } catch (error) {
        throw new EdgeError(
          'unreachable',
          abort.signal.aborted
            ? `${url} did not answer in ${connectMs / 1000} s`
            : `nothing answers at ${url}: ${describe(error)}`,
        );
      }
      await refusal(response, url);
      const body = response.body;
      if (!body) throw new EdgeError('not-an-edge', `${url} answered its stream with no body`);
      const reader = body.getReader();
      // The abort ends the read too, whatever `fetch` did with its signal (the deadline, `close`).
      abort.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), { once: true });
      const decoder = new TextDecoder();
      const parser = new SseParser();
      const pending: SseEvent[] = [];
      let first: SseEvent | undefined;
      while (!first) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw new EdgeError(
            'unreachable',
            abort.signal.aborted ? `${url} sent no connection id in ${connectMs / 1000} s` : describe(error),
          );
        }
        if (chunk.done && abort.signal.aborted) {
          throw new EdgeError('unreachable', `${url} sent no connection id in ${connectMs / 1000} s`);
        }
        if (chunk.done) throw new EdgeError('not-an-edge', `${url} ended its stream before its connection id`);
        pending.push(...parser.feed(decoder.decode(chunk.value, { stream: true })));
        first = pending.shift();
      }
      if (first.event !== 'connection' || !first.data) {
        abort.abort();
        throw new EdgeError('not-an-edge', `${url}'s stream did not begin with its connection id: is it a tau serve?`);
      }
      clearTimeout(timer);
      const transport = new HttpTransport(url, headers, fetchImpl, connectMs, abort, first.data);
      void transport.#pump(reader, decoder, parser, pending);
      return transport;
    } catch (error) {
      abort.abort();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#onMessage = handler;
    const early = this.#early;
    this.#early = [];
    for (const message of early) handler(message);
  }

  onClose(handler: (reason: string, violation: boolean) => void): void {
    this.#onClose = handler;
    if (this.#closedReason !== null) handler(this.#closedReason, this.#violation);
  }

  send(message: object): void {
    if (this.#closed) return; // the close was already reported; a caller learns it there
    const body = JSON.stringify(message);
    this.#queue = this.#queue.then(() => this.#post(body));
  }

  close(): void {
    this.#finish('closed by this client');
  }

  async #post(body: string): Promise<void> {
    if (this.#closed) return;
    let response: Response;
    try {
      response = await this.#fetch(new URL(`stream/${encodeURIComponent(this.id)}`, this.#url), {
        method: 'POST',
        headers: { ...this.#headers, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(postDeadline(this.#connectMs, body.length)),
      });
    } catch (error) {
      this.#finish(`a request could not be sent: ${describe(error)}`);
      return;
    }
    if (response.status === 202) return;
    const text = await response.text().catch(() => '');
    if (response.status === 404) {
      this.#finish('the server has no stream with this id any more');
    } else {
      this.#finish(`the server answered a request with HTTP ${response.status}${text ? `: ${text.trim()}` : ''}`);
    }
  }

  async #pump(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    parser: SseParser,
    pending: SseEvent[],
  ): Promise<void> {
    try {
      // Events read in the same chunk as the connection id; `#deliver` keeps them until a
      // handler is registered.
      if (!this.#deliver(pending)) return;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          this.#finish('the server ended the stream');
          return;
        }
        if (!this.#deliver(parser.feed(decoder.decode(chunk.value, { stream: true })))) return;
      }
    } catch (error) {
      this.#finish(this.#closed ? 'closed by this client' : `the stream broke: ${describe(error)}`);
    }
  }

  /** Hand each message up; false once the transport has closed (for a bad message, too). */
  #deliver(events: SseEvent[]): boolean {
    for (const event of events) {
      if (this.#closed) return false;
      if (event.event !== 'message') {
        this.#finish(`protocol violation: the stream sent an event of type '${event.event}'`, true);
        return false;
      }
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        this.#finish(`protocol violation: the stream sent a message that is not JSON: ${event.data.slice(0, 200)}`, true);
        return false;
      }
      if (this.#onMessage) this.#onMessage(message);
      else this.#early.push(message);
    }
    return !this.#closed;
  }

  #finish(reason: string, violation = false): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closedReason = reason;
    this.#violation = violation;
    this.#abort.abort();
    this.#onClose(reason, violation);
  }
}

/**
 * How long one POST may take: `connectMs`, and a second more for each MiB it carries. A message
 * with images (protocol 3) can be tens of MiB; held to the bare 10 s, a slow link would fail the
 * connection over an upload that was still going.
 */
export function postDeadline(connectMs: number, length: number): number {
  return connectMs + Math.ceil(length / (1024 * 1024)) * 1000;
}

/** Throw the `EdgeError` a non-stream answer to `GET /stream` means; return for a stream. */
async function refusal(response: Response, url: string): Promise<void> {
  const type = response.headers.get('content-type') ?? '';
  if (response.status === 200 && type.startsWith('text/event-stream')) return;
  if (response.status === 200) {
    await response.body?.cancel().catch(() => {}); // a page, not a stream: not read
    throw new EdgeError('not-an-edge', `${url} answered with no event stream: is it a tau serve?`, 200);
  }
  const text = (await response.text().catch(() => '')).trim().slice(0, 300);
  const said = `${url} answered HTTP ${response.status}${text ? `: ${text}` : ''}`;
  if (response.status === 401) throw new EdgeError('unauthorized', said, 401);
  if (response.status === 403) throw new EdgeError('forbidden', said, 403);
  // A proxy in front of τ (a dev server) says so when τ is not there: that can change.
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new EdgeError('unreachable', said, response.status);
  }
  throw new EdgeError('not-an-edge', said, response.status);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}
