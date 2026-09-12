import { accessSync, constants, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

/**
 * What this extension hands to `ffwf.tau-code`.
 *
 * `command` and `args` are the spawn, ready to use: the consumer appends tau's
 * own arguments and runs it. It deliberately does NOT hand over the console
 * script pip generated. That script carries an absolute shebang written at
 * install time, on the machine that BUILT the .vsix, and every machine that
 * installs it unpacks the extension somewhere else.
 *
 * `apiVersion` is on the object rather than derived from the extension version
 * because the two change for different reasons -- a rebuild against a new tau
 * moves the version and not this shape -- and a consumer that guesses from a
 * version string is the drift this exists to prevent.
 */
export interface TauRuntimeApi {
  readonly apiVersion: 1;
  /** The VS Code platform target this payload was built for, e.g. `linux-x64`. */
  readonly target: string;
  /** The payload root. Absolute, and different on every machine. */
  readonly root: string;
  /** The bundled interpreter. Absolute. */
  readonly interpreter: string;
  /** Spawn this. Identical to `interpreter`; named for what the consumer does with it. */
  readonly command: string;
  /** Put these before tau's own arguments. */
  readonly args: readonly string[];
  /**
   * A shell shim for humans: `bin/tau` on POSIX, `bin\tau.cmd` on Windows.
   *
   * Not what the extension spawns -- a .cmd needs a shell and spawning one
   * would be a shell injection surface for no gain. It exists so the shipped
   * environment is usable from a terminal, which is the difference between a
   * runtime this editor owns and a runtime that happens to live here.
   */
  readonly shim: string;
  /** `3.11.13`. */
  readonly pythonVersion: string;
  /** `0.10.1`, read from the installed dist-info at build time. */
  readonly tauVersion: string;
}

/** What `scripts/build-payload.mjs` writes beside the tree it assembled. */
interface Manifest {
  apiVersion: number;
  target: string;
  /** Every path below is RELATIVE to the payload root, because the root moves. */
  interpreter: string;
  shim: string;
  args: string[];
  pythonVersion: string;
  tauVersion: string;
  builtAt: string;
}

const MANIFEST = 'runtime/manifest.json';

function fail(detail: string): never {
  throw new Error(
    `The tau runtime extension is installed but its payload is unusable: ${detail} ` +
      `Reinstall ffwf.tau-runtime for this platform, or set "tau-code.runtime" to "system" ` +
      `to use a tau from PATH instead.`,
  );
}

/**
 * Read and check the payload.
 *
 * Fail Early, and loudly: this throws rather than returning a degraded API.
 * `ffwf.tau-code` awaits `activate()` and falls to its next candidate on a
 * rejection, so a broken payload becomes a sentence in the log and a banner --
 * where returning a half-API would become a spawn failure several layers away
 * from the file that is actually missing.
 */
function load(context: vscode.ExtensionContext): TauRuntimeApi {
  const root = context.extensionUri.fsPath;
  const manifestPath = join(root, MANIFEST);

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`could not read ${MANIFEST} (${detail}).`);
  }

  if (manifest.apiVersion !== 1) {
    fail(`${MANIFEST} declares apiVersion ${String(manifest.apiVersion)}, and this build reads 1.`);
  }

  const payload = join(root, 'runtime');
  const interpreter = join(payload, manifest.interpreter);
  try {
    // X_OK and not F_OK: an archive round trip that dropped the executable bit
    // produces a file that exists and cannot be run, and the spawn failure for
    // that is EACCES several seconds later with no path in it.
    accessSync(interpreter, constants.X_OK);
  } catch {
    fail(`no executable interpreter at ${interpreter}.`);
  }

  return {
    apiVersion: 1,
    target: manifest.target,
    root: payload,
    interpreter,
    command: interpreter,
    args: Object.freeze([...manifest.args]),
    shim: join(payload, manifest.shim),
    pythonVersion: manifest.pythonVersion,
    tauVersion: manifest.tauVersion,
  };
}

export function activate(context: vscode.ExtensionContext): TauRuntimeApi {
  // Loaded eagerly, so a broken payload is reported by the act of activating
  // rather than by the first thing that tried to use it.
  const api = load(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('tau-runtime.show', () => {
      const lines = [
        `tau ${api.tauVersion} on Python ${api.pythonVersion} (${api.target})`,
        '',
        `interpreter  ${api.interpreter}`,
        `shim         ${api.shim}`,
        `spawned as   ${[api.command, ...api.args].join(' ')} --mode rpc`,
      ].join('\n');
      // A modal, because this is a block of paths someone is reading to copy
      // out of, and a toast expires while they are still looking at it.
      void vscode.window.showInformationMessage(
        `tau runtime ${api.tauVersion}`,
        { modal: true, detail: lines },
        'Copy interpreter path',
      ).then((choice) => {
        if (choice === 'Copy interpreter path') void vscode.env.clipboard.writeText(api.interpreter);
      });
    }),

    vscode.commands.registerCommand('tau-runtime.copyPath', async () => {
      await vscode.env.clipboard.writeText(api.interpreter);
      void vscode.window.showInformationMessage(`Copied: ${api.interpreter}`);
    }),
  );

  return api;
}

export function deactivate(): void {
  // Nothing is running. This extension ships files and answers questions about
  // them; the tau process belongs to ffwf.tau-code, which reaps its own.
}
