import { LineFramer, relayRefusal } from '@tau-code/protocol';
import { StdioTransport, TauProcess, type TauProcessOptions } from '@tau-code/runner';

/** One connected browser. The hub does not care what it is beyond this. */
export interface HubClient {
  readonly id: number;
  send(line: string): void;
  close(code: number, reason: string): void;
}

/**
 * Relays JSON-RPC between many browser connections and ONE tau process.
 *
 * The relay is deliberately close to a pass-through: a browser speaks the same
 * protocol the VS Code extension host speaks, so `@tau-code/ui` runs unchanged
 * in both. Two things are NOT pass-through, and both are load-bearing.
 *
 * **Request ids are rewritten.** Every connection numbers its own requests from
 * 1, so two browsers both send `id: 1`. Forwarding those verbatim would make
 * tau's answers ambiguous and deliver one client's result to another. The hub
 * assigns its own upstream id, remembers the owner, and restores the original
 * id on the way back.
 *
 * **Events are broadcast; responses are not.** A response goes to the
 * connection that asked. Notifications -- `event` and `compaction_end` -- go to
 * everyone, so a second tab is a live view rather than a dead one.
 *
 * What this is NOT: a multiplexer. There is exactly one tau process and one
 * conversation, which keeps REMOTE-CONTROL.md decision 6 intact -- a
 * conversation has exactly one writing process. Several viewers of one
 * conversation is a different thing from several writers, and only the second
 * one is dangerous.
 *
 * Known gap, stated rather than hidden: there is no per-client backpressure
 * policy. A slow socket during a fast stream buffers in the ws layer. See
 * HEADS-AND-MULTIPLEXER.md section 5, which prices per-client output queues and
 * leaves the policy question open. It is not answered here.
 */
export class Hub {
  #proc: TauProcess;
  #transport: StdioTransport;
  #framer: LineFramer;
  #clients = new Map<number, HubClient>();
  #nextClientId = 1;
  #nextUpstreamId = 1;
  /** upstream id -> {client, original id} */
  #routes = new Map<number, { clientId: number; originalId: unknown }>();
  #stderrTail: string[] = [];
  #closed = false;
  #onLog: (line: string) => void;

  constructor(options: TauProcessOptions, onLog: (line: string) => void = () => {}) {
    this.#onLog = onLog;
    this.#proc = new TauProcess(options);
    this.#proc.start((chunk) => {
      // Keep a bounded tail. tau routes its own stdout to stderr in rpc mode,
      // so this is where a traceback lands -- worth reporting on a crash, not
      // worth holding unboundedly.
      this.#stderrTail.push(chunk);
      if (this.#stderrTail.length > 200) this.#stderrTail.shift();
      onLog(`[tau] ${chunk.trimEnd()}`);
    });

    this.#framer = new LineFramer(
      (value) => this.#fromTau(value),
      (line) => onLog(`[tau] unparseable line: ${line.slice(0, 200)}`),
    );

    this.#transport = new StdioTransport(this.#proc, (detail) => onLog(`[tau] ${detail}`));
    // The hub relays raw lines rather than driving a TauClient: it has no
    // opinion about the messages, and parsing them twice would be waste.
    this.#proc.child.stdout.removeAllListeners('data');
    this.#proc.child.stdout.on('data', (chunk: string) => this.#framer.push(chunk));

    void this.#proc.waitForExit().then((exit) => {
      const how = exit.signal !== null ? `killed by ${exit.signal}` : `exited (${exit.code})`;
      this.#closed = true;
      for (const client of this.#clients.values()) {
        client.close(1011, `tau ${how}`);
      }
      onLog(`[tau] ${how}. Last stderr:\n${this.#stderrTail.slice(-20).join('')}`);
    });
  }

  get running(): boolean {
    return !this.#closed && this.#proc.running;
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  attach(client: Omit<HubClient, 'id'>): HubClient {
    const id = this.#nextClientId++;
    const full: HubClient = { ...client, id };
    this.#clients.set(id, full);
    this.#onLog(`client ${id} attached (${this.#clients.size} connected)`);
    return full;
  }

  detach(clientId: number): void {
    if (!this.#clients.delete(clientId)) return;
    // Drop that client's outstanding routes: its answers have nowhere to go.
    for (const [upstream, route] of this.#routes) {
      if (route.clientId === clientId) this.#routes.delete(upstream);
    }
    this.#onLog(`client ${clientId} detached (${this.#clients.size} connected)`);
  }

  /** One raw line from a browser, on its way to tau. */
  fromClient(clientId: number, raw: string): void {
    if (!this.running) {
      // A request is answered, never dropped. A client attached BEFORE tau died
      // learns from the 1011 close above; one that connects afterwards -- a
      // reload, a second tab -- gets no close at all, and its
      // `get_capabilities` would wait forever behind a deadline-free `call`.
      // That is `connecting` on screen with the reason only in this log.
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      const refusal = relayRefusal(
        message,
        'tau is no longer running behind this server. Restart the server to get a new agent.',
      );
      if (refusal) this.#clients.get(clientId)?.send(JSON.stringify(refusal));
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.#clients.get(clientId)?.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'The server could not parse that line as JSON.' },
        }),
      );
      return;
    }

    // A response (to a future reverse-channel request) has no method: pass it
    // through untouched. Its id is tau's, not ours.
    if (typeof message['method'] !== 'string') {
      this.#proc.child.stdin.write(JSON.stringify(message) + '\n');
      return;
    }

    // A notification has no id and needs no route.
    if (message['id'] === undefined || message['id'] === null) {
      this.#proc.child.stdin.write(JSON.stringify(message) + '\n');
      return;
    }

    const upstreamId = this.#nextUpstreamId++;
    this.#routes.set(upstreamId, { clientId, originalId: message['id'] });
    this.#proc.child.stdin.write(JSON.stringify({ ...message, id: upstreamId }) + '\n');
  }

  #fromTau(value: unknown): void {
    if (typeof value !== 'object' || value === null) return;
    const message = value as Record<string, unknown>;

    // Notification, or a server-originated request: everyone sees it.
    // A reverse-channel request reaching several clients would be a real
    // problem -- several answers to one id -- but ui_methods is [] on every
    // tau shipped so far, so nothing sends one. When it does, this is the
    // line that has to choose an owner. It is marked, not silently wrong.
    if (typeof message['method'] === 'string') {
      const line = JSON.stringify(message) + '\n';
      for (const client of this.#clients.values()) client.send(line);
      return;
    }

    const upstreamId = message['id'];
    if (typeof upstreamId !== 'number') return;
    const route = this.#routes.get(upstreamId);
    if (!route) return;
    this.#routes.delete(upstreamId);
    const client = this.#clients.get(route.clientId);
    if (!client) return;
    client.send(JSON.stringify({ ...message, id: route.originalId }) + '\n');
  }

  async stop(): Promise<void> {
    this.#closed = true;
    for (const client of this.#clients.values()) client.close(1001, 'server shutting down');
    this.#clients.clear();
    this.#transport.close();
    await this.#proc.stop();
  }
}
