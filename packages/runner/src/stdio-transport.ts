import { LineFramer, frame, type Transport } from '@ffwf/tau-code-protocol';
import type { TauProcess } from './process.js';

/**
 * A `Transport` over a `TauProcess`'s stdin/stdout.
 *
 * This is the transport the VS Code extension host and the connection server
 * both use. They differ in what they do with the client above it, not in how
 * they reach tau.
 */
export class StdioTransport implements Transport {
  #framer: LineFramer;
  #onMessage: ((message: unknown) => void) | null = null;
  #onClose: ((reason: string) => void) | null = null;
  #closed = false;

  constructor(
    private readonly proc: TauProcess,
    private readonly onViolation?: (detail: string) => void,
  ) {
    this.#framer = new LineFramer(
      (value) => this.#onMessage?.(value),
      (line, error) => {
        // Reported, never dropped silently. A line that does not parse is a
        // protocol fault on tau's side and the host should be able to see it.
        this.onViolation?.(`unparseable line (${String(error)}): ${line.slice(0, 400)}`);
      },
    );

    proc.child.stdout.on('data', (chunk: string) => this.#framer.push(chunk));

    proc.waitForExit().then(
      (exit) => {
        const pending = this.#framer.pending;
        const trailing = pending ? ` Last partial line: ${pending.slice(0, 200)}` : '';
        const how =
          exit.signal !== null ? `killed by ${exit.signal}` : `exited with code ${exit.code}`;
        this.#fire(`tau ${how}.${trailing}`);
      },
      (error) => this.#fire(`tau could not be started: ${String(error)}`),
    );
  }

  send(message: unknown): void {
    if (this.#closed) return;
    this.proc.child.stdin.write(frame(message));
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#onMessage = handler;
  }

  onClose(handler: (reason: string) => void): void {
    this.#onClose = handler;
  }

  close(): void {
    if (this.#closed) return;
    void this.proc.stop();
  }

  #fire(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#onClose?.(reason);
  }
}
