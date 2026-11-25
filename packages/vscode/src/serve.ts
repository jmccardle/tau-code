import { execFile } from 'node:child_process';
import { PROTOCOL } from '@ffwf/tau-code-protocol';
import type * as vscode from 'vscode';
import { describe, incompatible, tauRuntime, type TauResolution } from './runtime.js';

/**
 * Starting and stopping the `tau serve` a panel talks to.
 *
 * τ ≥ 0.17 serves ONE session per process (D21), over a Unix socket and the HTTP edge (D29). So a
 * panel is one session, and this is the whole of finding its server: `tau serve -d --json <session
 * flags>`, run in the workspace folder. `-d` is idempotent: if that session is already served
 * (another panel, another window, a terminal `tau serve`), it prints the running server's record
 * instead of starting a second one. Either way it prints the serve record, with the HTTP edge's
 * `url` and bearer `token`.
 *
 * Under Remote SSH, WSL or a devcontainer this runs on the REMOTE machine, because that is where
 * the extension host runs: the server starts next to the files its tools touch, and the HTTP edge
 * stays on the remote's loopback. The webview never dials it; the host relays (relay.ts).
 */

/** The parts of the serve record (`tau serve -d --json`) this extension reads. */
export interface ServeRecord {
  session: string;
  pid: number;
  cwd: string;
  protocol: number;
  version: string;
  log: string;
  /** The HTTP edge's root, `http://127.0.0.1:3393/`. Absent when the server runs `--no-http`. */
  url?: string;
  token?: string;
  /** True when this call started it; false when it was already running. */
  started?: boolean;
}

/** Which session a panel opens. */
export type SessionChoice =
  /** This session, by id: a restored panel, or a reconnect. */
  | { session: string }
  /** The newest session of the folder (`-c`), or a new one when the folder has none. */
  | 'continue'
  /** A new session. */
  | 'new';

/** Why there is no server to dial, as a sentence a person can act on. */
export class NoServer extends Error {
  constructor(
    message: string,
    /** The resolution, when there was one, for the "which τ" notice. */
    readonly resolution: TauResolution | null,
    /** The chosen τ cannot speak this extension's protocol (compat.ts); choosing another τ fixes it. */
    readonly incompatible = false,
  ) {
    super(message);
    this.name = 'NoServer';
  }
}

/** τ's own `--json` error line: `{"error": {"type", "message"}}`. */
interface TauJsonError {
  error: { type: string; message: string };
}

function isTauError(value: unknown): value is TauJsonError {
  const error = (value as TauJsonError | null)?.error;
  return typeof error?.type === 'string' && typeof error.message === 'string';
}

/** A session flag that names no session: start the next choice instead. */
class UnknownSession extends Error {}

export interface Started {
  record: ServeRecord & { url: string; token: string };
  resolution: TauResolution;
}

/**
 * Start (or find) the server for `choice`, in `cwd`.
 *
 * - `{session}`: `--session <id>`. If τ has no such session it was never written (τ saves a
 *   session at its first node; a panel closed before anyone typed leaves nothing) or it was
 *   deleted: then a new one, and `replaced` says so.
 * - `continue`: `-c`; a folder with no session yet gets a new one.
 * - `new`: no session flag.
 */
export async function startServer(
  output: vscode.LogOutputChannel,
  cwd: string,
  choice: SessionChoice,
): Promise<Started & { replaced: string | null }> {
  const resolution = await tauRuntime(output);
  output.info(describe(resolution));
  const chosen = resolution.chosen;
  if (!chosen) throw new NoServer(resolution.problem ?? 'No tau was found.', resolution);
  // Before spawning: a τ before 0.17 would start a daemon this extension cannot talk to.
  const refused = incompatible(resolution);
  if (refused) throw new NoServer(refused, resolution, true);

  const attempts: string[][] =
    choice === 'new' ? [[]] : choice === 'continue' ? [['-c'], []] : [['--session', choice.session], []];
  for (const [index, flags] of attempts.entries()) {
    const args = [...chosen.args, 'serve', '-d', '--json', ...flags];
    output.info(`Starting the server: ${chosen.command} ${args.join(' ')} (in ${cwd})`);
    let record: ServeRecord;
    try {
      record = await serveJson(chosen.command, args, cwd, resolution);
    } catch (error) {
      if (error instanceof UnknownSession && index < attempts.length - 1) {
        output.info(`${error.message}; starting a new session.`);
        continue;
      }
      throw error;
    }
    const checked = check(record, resolution);
    output.info(
      checked.started
        ? `Started tau serve ${checked.version} for session ${checked.session} at ${checked.url} (pid ${checked.pid}); it logs to ${checked.log}.`
        : `tau serve ${checked.version} is already serving session ${checked.session} at ${checked.url} (pid ${checked.pid}).`,
    );
    const replaced = typeof choice === 'object' && index > 0 ? choice.session : null;
    return { record: checked, resolution, replaced };
  }
  // Unreachable: the last attempt has no session flag, so it cannot be UnknownSession.
  throw new NoServer('tau serve -d named no session.', resolution);
}

/** A record this client can use: protocol 2, and an HTTP edge. */
function check(record: ServeRecord, resolution: TauResolution): Started['record'] {
  if (record.protocol !== PROTOCOL) {
    // τ before 0.17 prints a daemon record with no `protocol` and no `version` at all.
    const speaks = typeof record.protocol === 'number' ? `protocol ${String(record.protocol)}` : 'an older protocol';
    throw new NoServer(
      `tau ${record.version ?? '(a version before 0.17, by its serve record)'} speaks ${speaks}, and this extension speaks ${PROTOCOL} ` +
        `(tau ≥ 0.17.0). Install a matching tau, or choose another with "tau: Choose Which tau Starts the Server".`,
      resolution,
    );
  }
  if (typeof record.url !== 'string' || typeof record.token !== 'string') {
    throw new NoServer(
      `The tau serve for session ${record.session} (pid ${record.pid}) has no HTTP edge (it was started with ` +
        `--no-http), and this extension talks to it over HTTP. Stop it ("tau: Restart This Session's tau Server").`,
      resolution,
    );
  }
  return record as Started['record'];
}

/**
 * Stop the server of `session`: `tau serve --stop --json --session <id>`. Every client of it (other
 * panels, browser tabs, `tau -c`) is disconnected; the session is kept.
 */
export async function stopServer(output: vscode.LogOutputChannel, cwd: string, session: string): Promise<void> {
  const resolution = await tauRuntime(output);
  const chosen = resolution.chosen;
  if (!chosen) throw new NoServer(resolution.problem ?? 'No tau was found.', resolution);
  const refused = incompatible(resolution);
  if (refused) throw new NoServer(refused, resolution, true);
  const args = [...chosen.args, 'serve', '--stop', '--json', '--session', session];
  output.info(`Stopping the server: ${chosen.command} ${args.join(' ')}`);
  const stopped = (await serveJson(chosen.command, args, cwd, resolution)) as unknown as {
    stopped?: boolean;
    pid?: number;
  };
  output.info(stopped.stopped ? `Stopped tau serve for ${session} (pid ${String(stopped.pid)}).` : `No server was running for ${session}.`);
}

/** Run a `tau serve … --json` and read its one JSON line; τ's error line becomes an exception. */
function serveJson(command: string, args: string[], cwd: string, resolution: TauResolution): Promise<ServeRecord> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      const line = stdout.trim().split('\n').at(-1) ?? '';
      let parsed: unknown = null;
      try {
        parsed = line ? JSON.parse(line) : null;
      } catch {
        parsed = null;
      }
      if (isTauError(parsed)) {
        const { type, message } = parsed.error;
        reject(type === 'UnknownSession' ? new UnknownSession(message) : new NoServer(`tau serve refused: ${message} (${type})`, resolution));
        return;
      }
      if (error) {
        const said = stderr.trim() || stdout.trim() || error.message;
        reject(new NoServer(`\`${command} ${args.join(' ')}\` failed: ${said}`, resolution));
        return;
      }
      if (parsed === null || typeof parsed !== 'object') {
        reject(
          new NoServer(
            `\`tau serve --json\` printed something that is not a serve record, so this tau predates what the ` +
              `extension needs (tau ≥ 0.17.0). It printed: ${stdout.slice(0, 300)}`,
            resolution,
          ),
        );
        return;
      }
      resolve(parsed as ServeRecord);
    });
  });
}
