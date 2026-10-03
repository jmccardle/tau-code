import { execFile } from 'node:child_process';
import type * as vscode from 'vscode';
import { describe, tauRuntime, type TauResolution } from './runtime.js';

/**
 * Finding the daemon this window's panels dial, starting it if need be.
 *
 * The whole of it is one command: `tau serve -d --json`. τ resolves the
 * address the way it always does (flag, else config `serve.listen`, else its
 * default), and either finds a daemon already answering `hello` there or starts
 * one and waits until it does. Either way it prints one JSON object naming the
 * address, and exits 0.
 *
 * That is deliberately ALL of it. The extension does not read
 * `~/.tau/config.json` and does not know τ's default port: a second copy of
 * that logic is how a panel dials 8256 while the user's daemon listens on
 * 8300, finds nothing, and starts a second daemon over the same session store
 * -- two writers on one session, which is the one thing τ's design forbids.
 *
 * Under Remote SSH, WSL or a devcontainer this runs on the REMOTE machine,
 * because that is where the extension host runs. The daemon starts there, next
 * to the files its tools touch, and the panel stays local. Nothing here knows
 * the difference, which is the point of the relay.
 */

/** What `tau serve -d --json` prints. */
export interface DaemonStart {
  address: string;
  pid: number;
  /** True when this call started it; false when one was already running. */
  started: boolean;
  log: string;
}

export interface DaemonFound {
  start: DaemonStart;
  resolution: TauResolution;
}

/** Why there is nothing to dial, as a sentence a person can act on. */
export class NoDaemon extends Error {
  constructor(
    message: string,
    /** The resolution, when there was one, for the "which τ" banner. */
    readonly resolution: TauResolution | null,
  ) {
    super(message);
    this.name = 'NoDaemon';
  }
}

let pending: Promise<DaemonFound> | null = null;

/**
 * The daemon's address, memoised across every panel in this window.
 *
 * Shared because the panels share the daemon: two panels starting it at once
 * would be harmless (the second finds the first) but slower, and they would
 * log the same decision twice.
 */
export function findDaemon(output: vscode.LogOutputChannel): Promise<DaemonFound> {
  pending ??= locate(output).catch((error: unknown) => {
    // A failure is not memoised: the next panel, or a restart, asks again.
    pending = null;
    throw error;
  });
  return pending;
}

/** Forget the address: the next dial runs `tau serve -d` again. */
export function forgetDaemon(): void {
  pending = null;
}

async function locate(output: vscode.LogOutputChannel): Promise<DaemonFound> {
  const resolution = await tauRuntime(output);
  output.info(describe(resolution));
  const chosen = resolution.chosen;
  if (!chosen) throw new NoDaemon(resolution.problem ?? 'No tau was found.', resolution);

  const args = [...chosen.args, 'serve', '-d', '--json'];
  output.info(`Finding the daemon: ${chosen.command} ${args.join(' ')}`);
  const { stdout, stderr } = await run(chosen.command, args).catch((error: unknown) => {
    throw new NoDaemon(
      `\`tau serve -d\` failed, so there is no daemon to connect to. ${error instanceof Error ? error.message : String(error)}`,
      resolution,
    );
  });
  if (stderr.trim()) output.warn(stderr.trim());

  let start: DaemonStart;
  try {
    start = JSON.parse(stdout) as DaemonStart;
  } catch {
    throw new NoDaemon(
      `\`tau serve -d --json\` printed something that is not JSON, so this τ predates what the ` +
        `extension needs (serve protocol 0.2). It printed: ${stdout.slice(0, 300)}`,
      resolution,
    );
  }
  if (typeof start.address !== 'string') {
    throw new NoDaemon(`\`tau serve -d --json\` named no address: ${stdout.slice(0, 300)}`, resolution);
  }
  output.info(
    start.started
      ? `Started tau serve on ${start.address} (pid ${start.pid}); it logs to ${start.log}.`
      : `tau serve is already running on ${start.address} (pid ${start.pid}).`,
  );
  return { start, resolution };
}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * The WebSocket URL for an address as τ prints it.
 *
 * `HOST:PORT` dials over TCP. A `unix:/PATH` daemon is refused here by name:
 * the `ws` client can dial one, but nothing in this extension has been run
 * against one, and a transport that has never been exercised is not offered.
 */
export function socketUrl(address: string): string {
  if (address.startsWith('unix:')) {
    throw new NoDaemon(
      `The daemon listens on ${address}, a Unix socket, and this extension dials TCP only. ` +
        `Set serve.listen to HOST:PORT in ~/.tau/config.json.`,
      null,
    );
  }
  return `ws://${address}/`;
}
