import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface TauProcessOptions {
  /** Path to tau's console script. A bare `tau` uses PATH. */
  bin?: string;
  /** Working directory the agent's tools resolve relative paths against. */
  cwd?: string;
  /** `--model`. Omit to use tau's configured default. */
  model?: string;
  /** `--provider`. */
  provider?: string;
  /**
   * `--no-session`. When true, nothing this connection does is written to the
   * store, and the appending verbs refuse with SESSION_NOT_PERSISTED (-32004).
   * `get_state().addressable` reports the same predicate, so a client can ask
   * rather than discover it by tripping the error.
   */
  noSession?: boolean;
  /**
   * `--session-dir`. Where session logs are written.
   *
   * **This is what decides whether the TUI and this client share sessions.**
   * tau's default for `--mode rpc` is a private `<tmp>/.tau-<uid>/sessions`,
   * deliberately, so an RPC host does not fill the user's session list. The TUI
   * and `--print` use `~/.tau/sessions`. Point both at one directory and the
   * two are fully interchangeable: measured, `switch_session` resumes a session
   * the TUI wrote, and the TUI's `--continue` resumes one this client wrote.
   *
   * The temp default also means those sessions do not survive a reboot on a
   * system that clears its temp directory.
   */
  sessionDir?: string;
  /** Extra arguments appended verbatim. */
  extraArgs?: string[];
  /** Environment overlaid on the parent's. */
  env?: Record<string, string>;
}

export interface TauExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Everything tau wrote to stderr. See the note on `onStderr`. */
  stderr: string;
}

/**
 * A supervised `tau --mode rpc` child process.
 *
 * Two things here are not incidental.
 *
 * **stderr is a real channel, not noise.** In `--mode rpc` tau claims stdout
 * exclusively for the protocol and rebinds `sys.stdout` to stderr, so anything
 * the agent or an extension prints -- and every traceback -- arrives on stderr.
 * Discarding it turns a crash into an unexplained disconnect. This class buffers
 * it and hands it to `onStderr` and to the exit result.
 *
 * **Shutdown is a process-GROUP kill.** REMOTE-CONTROL.md decision 5: the
 * process boundary is a guarantee, which means killing the group rather than
 * the direct child. tau runs tools -- a `bash` tool call spawns grandchildren,
 * and killing only the child orphans them still holding the working tree.
 */
export class TauProcess {
  #child: ChildProcessWithoutNullStreams | null = null;
  #stderr = '';
  #exited: Promise<TauExit> | null = null;
  readonly #options: TauProcessOptions;

  constructor(options: TauProcessOptions = {}) {
    this.#options = options;
  }

  get argv(): string[] {
    const { model, provider, noSession, sessionDir, extraArgs } = this.#options;
    const args = ['--mode', 'rpc'];
    if (model) args.push('--model', model);
    if (provider) args.push('--provider', provider);
    if (noSession) args.push('--no-session');
    if (sessionDir) args.push('--session-dir', sessionDir);
    if (extraArgs) args.push(...extraArgs);
    return args;
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  get running(): boolean {
    return this.#child !== null && this.#child.exitCode === null && !this.#child.killed;
  }

  /** The live child. Throws before `start()`, which is the honest answer. */
  get child(): ChildProcessWithoutNullStreams {
    if (!this.#child) throw new Error('TauProcess has not been started.');
    return this.#child;
  }

  start(onStderr?: (chunk: string) => void): void {
    if (this.#child) throw new Error('TauProcess is already started.');
    const bin = this.#options.bin ?? process.env['TAU_BIN'] ?? 'tau';

    const child = spawn(bin, this.argv, {
      cwd: this.#options.cwd ?? process.cwd(),
      env: { ...process.env, ...this.#options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group, so shutdown can reap the whole tree.
      detached: process.platform !== 'win32',
    }) as ChildProcessWithoutNullStreams;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.#stderr += chunk;
      onStderr?.(chunk);
    });

    this.#child = child;
    this.#exited = new Promise<TauExit>((resolve, reject) => {
      child.on('error', (error) => {
        reject(
          new Error(
            `Could not run '${bin}': ${error.message}. ` +
              `Set TAU_BIN to tau's console script, or put it on PATH.`,
          ),
        );
      });
      child.on('exit', (code, signal) => {
        resolve({ code, signal, stderr: this.#stderr });
      });
    });
  }

  /** Resolves when the child exits. */
  waitForExit(): Promise<TauExit> {
    if (!this.#exited) throw new Error('TauProcess has not been started.');
    return this.#exited;
  }

  /** Everything the child has written to stderr so far. */
  get stderr(): string {
    return this.#stderr;
  }

  /**
   * Ask the child to stop, then make sure it did.
   *
   * Closing stdin is the graceful signal: tau treats stdin EOF as "the peer is
   * gone" and unwinds. If the group is still alive after `graceMs`, it is
   * SIGKILLed -- the guarantee is that the process is gone, not that it agreed
   * to go.
   */
  async stop(graceMs = 3000): Promise<TauExit> {
    if (!this.#child || !this.#exited) throw new Error('TauProcess has not been started.');
    const exited = this.#exited;
    if (!this.running) return exited;

    this.#child.stdin.end();

    const timer = setTimeout(() => this.#killGroup('SIGKILL'), graceMs);
    try {
      return await exited;
    } finally {
      clearTimeout(timer);
    }
  }

  #killGroup(signal: NodeJS.Signals): void {
    const child = this.#child;
    if (!child || child.pid === undefined) return;
    try {
      if (process.platform === 'win32') {
        child.kill(signal);
      } else {
        // Negative pid addresses the whole group (decision 5).
        process.kill(-child.pid, signal);
      }
    } catch {
      // Already gone. Nothing to reap, and nothing to report.
    }
  }
}
